import Redis from 'ioredis';
import { getEnv, SandboxBuildError } from '@iicpc/shared';
import { downloadArtifact, cleanupWorkDir } from './minio-client.js';
import { detectLanguage, buildImage } from './builder.js';
import { startContainer, removeContainer } from './runner.js';
import { waitForHealthy } from './health-poller.js';
import { publishSubmissionReady, publishSubmissionStopped } from './publisher.js';
import { watchContainer } from './watchdog.js';

const redis = new Redis(getEnv('REDIS_URL'));

type Status = 'queued' | 'building' | 'running' | 'error' | 'stopped';

async function setStatus(submissionId: string, status: Status) {
  await redis.set(`submission:${submissionId}:status`, status);
  console.log(`[sandbox] ${submissionId} → ${status}`);
}

/**
 * Full build-and-run pipeline for one submission.
 * Called by POST /sandbox/deploy — runs asynchronously (does NOT block the HTTP response).
 *
 * Steps:
 *  queued → building → (docker build) → (docker run) → (health poll) → running
 *  any failure → error + submission.stopped published
 */
export async function deploy(submissionId: string, artifactPath: string): Promise<void> {
  let containerId: string | null = null;

  try {
    // ── Step 1: Download artifact from MinIO ──────────────────────────────
    await setStatus(submissionId, 'building');
    const workDir = await downloadArtifact(submissionId, artifactPath);

    // ── Step 2: Detect language ───────────────────────────────────────────
    const language = detectLanguage(workDir);
    console.log(`[sandbox] detected language: ${language} for ${submissionId}`);

    // Store language back into Redis meta (overwrite if already set)
    await redis.hset(`submission:${submissionId}:meta`, { language });

    // ── Step 3: Build Docker image ────────────────────────────────────────
    const imageTag = await buildImage(submissionId, workDir, language);

    // ── Step 4: Cleanup temp source files — image is already built ────────
    await cleanupWorkDir(submissionId);

    // ── Step 5: Start container with isolation config ─────────────────────
    const { containerId: cId, host, port } = await startContainer(submissionId, imageTag);
    containerId = cId;

    // Store container info in Redis for admin lookups
    await redis.hset(`submission:${submissionId}:meta`, {
      containerId,
      containerHost: host,
      containerPort: port.toString(),
    });

    // ── Step 6: Poll /health until ready ─────────────────────────────────
    await waitForHealthy(submissionId, host, port);

    // ── Step 7: Mark running + publish submission.ready ───────────────────
    await setStatus(submissionId, 'running');
    await publishSubmissionReady({ submissionId, host, port });

    // ── Step 8: Watch container — clean up on error or SIGTERM ────────────
    watchContainer(containerId, submissionId).catch((err) => {
      console.error(`[sandbox] watchdog error for ${submissionId}:`, err);
    });

  } catch (err) {
    console.error(`[sandbox] pipeline failed for ${submissionId}:`, err);

    await setStatus(submissionId, 'error');

    // Clean up the container if it was created
    if (containerId) {
      await removeContainer(containerId);
    }

    // Signal bot-fleet to not start (in case message arrived before error)
    await publishSubmissionStopped({
      submissionId,
      reason: err instanceof Error && err.name === 'ContainerTimeoutError'
        ? 'timeout'
        : 'error',
    });

    throw new SandboxBuildError(
      `Pipeline failed for ${submissionId}`,
      err,
    );
  }
}
