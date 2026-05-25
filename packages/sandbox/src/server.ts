import 'dotenv/config';
import express from 'express';
import { getEnvNumber } from '@iicpc/shared';
import { deploy } from './pipeline.js';
import { disconnectProducer } from './publisher.js';
import { preWarmImages } from './builder.js';
import { removeContainer } from './runner.js';
import Dockerode from 'dockerode';
import Redis from 'ioredis';
import { getEnv } from '@iicpc/shared';

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
const redis  = new Redis(getEnv('REDIS_URL'));

const app = express();
app.use(express.json());

// GET /health — sandbox's own liveness probe
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sandbox' });
});

/**
 * POST /sandbox/deploy
 * Called internally by the gateway after a successful file upload.
 * Body: { submissionId: string, artifactPath: string }
 *
 * Returns 202 immediately — the build pipeline runs async.
 * The gateway doesn't wait for the container to be ready.
 */
app.post('/sandbox/deploy', async (req, res) => {
  const { submissionId, artifactPath } = req.body as {
    submissionId: string;
    artifactPath: string;
  };

  if (!submissionId || !artifactPath) {
    res.status(400).json({ error: 'submissionId and artifactPath are required' });
    return;
  }

  // Respond immediately — pipeline runs in background
  res.status(202).json({ message: 'pipeline started', submissionId });

  // Fire-and-forget — errors are caught inside deploy() and written to Redis
  deploy(submissionId, artifactPath).catch((err) => {
    console.error(`[sandbox] unhandled pipeline error for ${submissionId}:`, err);
  });
});

/**
 * POST /sandbox/stop
 * Called by the gateway's DELETE /runs/:id route.
 * Finds the container by naming convention (submission-{id}),
 * stops it cleanly, removes it, and frees up memory.
 *
 * This is the primary container cleanup path.
 */
app.post('/sandbox/stop', async (req, res) => {
  const { submissionId } = req.body as { submissionId: string };
  if (!submissionId) {
    res.status(400).json({ error: 'submissionId is required' });
    return;
  }

  console.log(`[sandbox] stop requested for ${submissionId}`);

  try {
    // ── Look up containerId from Redis meta ─────────────────────────────────
    const meta = await redis.hgetall(`submission:${submissionId}:meta`);
    const containerId = meta?.containerId;

    if (!containerId) {
      // No container tracked — try by name as fallback
      try {
        const containers = await docker.listContainers({
          all: true,
          filters: { name: [`submission-${submissionId}`] },
        });
        if (containers.length === 0) {
          console.warn(`[sandbox] no container found for ${submissionId} — already removed`);
          return res.json({ submissionId, status: 'already_removed' });
        }
        await removeContainer(containers[0].Id);
      } catch (fallbackErr) {
        console.warn(`[sandbox] fallback stop failed for ${submissionId}:`, fallbackErr);
      }
      return res.json({ submissionId, status: 'stopped' });
    }

    // ── Remove the container (stop + rm + volumes) ───────────────────────────
    await removeContainer(containerId);

    // ── Also remove the built image to free disk space ───────────────────────
    try {
      const imageTag = `submission-${submissionId}:latest`;
      await docker.getImage(imageTag).remove({ force: true });
      console.log(`[sandbox] image ${imageTag} removed`);
    } catch {
      // image may already be gone — non-fatal
    }

    // ── Clean up Redis meta ──────────────────────────────────────────────────
    await redis.del(`submission:${submissionId}:meta`);
    await redis.del(`submission:${submissionId}:score`);

    console.log(`[sandbox] ${submissionId} fully cleaned up`);
    return res.json({ submissionId, status: 'stopped', cleaned: true });

  } catch (err) {
    console.error(`[sandbox] stop error for ${submissionId}:`, (err as Error).message);
    return res.status(500).json({ error: 'Failed to stop container', details: (err as Error).message });
  }
});

/**
 * GET /sandbox/status
 * Returns a summary of all running submission containers and their resource usage.
 * Used by admin dashboard to monitor active containers.
 */
app.get('/sandbox/status', async (_req, res) => {
  try {
    const containers = await docker.listContainers({
      filters: { name: ['submission-'] },
    });

    const summary = containers.map(c => ({
      containerId: c.Id.slice(0, 12),
      name: c.Names[0]?.replace('/', ''),
      state: c.State,
      status: c.Status,
      image: c.Image,
      created: new Date(c.Created * 1000).toISOString(),
    }));

    return res.json({ count: summary.length, containers: summary });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list containers' });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[sandbox] SIGTERM received, shutting down...');
  await disconnectProducer();
  redis.disconnect();
  process.exit(0);
});

const PORT = getEnvNumber('SANDBOX_PORT', 3001);
app.listen(PORT, () => {
  console.log(`[sandbox] listening on port ${PORT}`);
  // Pre-pull base images in the background — non-blocking
  preWarmImages().catch(err =>
    console.warn('[sandbox] pre-warm error (non-fatal):', (err as Error).message)
  );
});
