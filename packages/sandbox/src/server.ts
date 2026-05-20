import 'dotenv/config';
import express from 'express';
import { getEnvNumber } from '@iicpc/shared';
import { deploy } from './pipeline.js';
import { disconnectProducer } from './publisher.js';

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

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[sandbox] SIGTERM received, shutting down...');
  await disconnectProducer();
  process.exit(0);
});

const PORT = getEnvNumber('SANDBOX_PORT', 3001);
app.listen(PORT, () => {
  console.log(`[sandbox] listening on port ${PORT}`);
});
