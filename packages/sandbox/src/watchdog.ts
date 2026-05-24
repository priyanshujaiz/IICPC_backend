import Dockerode from 'dockerode';
import Redis from 'ioredis';
import { getEnv, getEnvNumber } from '@iicpc/shared';
import { publishSubmissionStopped } from './publisher.js';
import { removeContainer } from './runner.js';

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
const redis  = new Redis(getEnv('REDIS_URL'));

const MAX_RUNTIME_MS = getEnvNumber('MAX_RUNTIME_MS', 10 * 60 * 1000); // 10 min default

async function setStatus(submissionId: string, status: string): Promise<void> {
  await redis.set(`submission:${submissionId}:status`, status);
  console.log(`[watchdog] ${submissionId} → ${status}`);
}

/**
 * Watches a running container and cleans up when it exits for ANY reason:
 *   - contestant code crashed / segfaulted
 *   - OOM kill by Docker
 *   - max runtime exceeded
 *
 * Call this fire-and-forget (do NOT await) after publishSubmissionReady.
 */
export async function watchContainer(
  containerId: string,
  submissionId: string,
): Promise<void> {
  console.log(`[watchdog] watching ${submissionId} — max ${MAX_RUNTIME_MS / 60_000}min`);

  // ── Max runtime enforcer ──────────────────────────────────────────────────
  let timedOut = false;

  const killTimer = setTimeout(async () => {
    timedOut = true;
    console.warn(`[watchdog] ${submissionId} exceeded max runtime — force stopping`);
    try {
      await docker.getContainer(containerId).stop({ t: 5 });
    } catch {
      // container may already be gone — that's fine
    }
  }, MAX_RUNTIME_MS);

  // ── Wait for container to exit ────────────────────────────────────────────
  try {
    await docker.getContainer(containerId).wait();
  } catch (err) {
    // container.wait() rejects if container doesn't exist — treat as already stopped
    console.warn(`[watchdog] container.wait() failed for ${submissionId}:`, err);
  } finally {
    clearTimeout(killTimer);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log(`[watchdog] ${submissionId} exited — cleaning up (timeout=${timedOut})`);

  try {
    await setStatus(submissionId, 'stopped');

    await publishSubmissionStopped({
      submissionId,
      reason: timedOut ? 'timeout' : 'error',
    });

    await removeContainer(containerId);
  } catch (cleanupErr) {
    console.error(`[watchdog] cleanup error for ${submissionId}:`, cleanupErr);
  }
}
