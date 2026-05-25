import { Router } from 'express';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { getEnv } from '@iicpc/shared';
import { submissions } from '@iicpc/shared';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';

export const runsRouter: Router = Router();
const redis = new Redis(getEnv('REDIS_URL'));
const SANDBOX_URL = getEnv('SANDBOX_URL');

// ── GET /runs/:id — real-time status for one submission (Redis fast path) ─────

runsRouter.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  const status = await redis.get(`submission:${id}:status`);
  if (!status) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  const meta = await redis.hgetall(`submission:${id}:meta`);
  return res.json({ submissionId: id, status, ...meta });
});

// ── GET /runs — all submissions for the current authenticated user ─────────────
// Reads from PostgreSQL (persistent, survives Redis flush)

runsRouter.get('/', requireAuth, async (req, res) => {
  const userId = req.user!.userId;

  const rows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.contestantId, userId))
    .orderBy(submissions.submittedAt);

  return res.json({ count: rows.length, submissions: rows });
});

// ── DELETE /runs/:id — admin stop a running submission ─────────────────────────
// Sets the fleet:stop Redis key, publishes submission.stopped to Kafka,
// and updates the submission status in PostgreSQL.

runsRouter.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  // Verify submission exists
  const status = await redis.get(`submission:${id}:status`);
  if (!status) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  if (status === 'stopped' || status === 'error') {
    return res.status(409).json({ error: `Submission is already ${status}` });
  }

  try {
    // 1. Signal bots to stop via Redis (30s TTL — self-cleaning)
    await redis.set(`fleet:stop:${id}`, '1', 'EX', 30);

    // 2. Mark status as stopped in Redis immediately
    await redis.set(`submission:${id}:status`, 'stopped', 'EX', 86400);

    // 3. Tell sandbox to stop and remove the container + image
    try {
      await fetch(`${SANDBOX_URL}/sandbox/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: id }),
      });
    } catch (sandboxErr) {
      // Non-fatal: sandbox may already have cleaned up
      console.warn(`[gateway] sandbox stop call failed for ${id}:`, (sandboxErr as Error).message);
    }

    // 4. Persist stopped_at to TimescaleDB
    await db
      .update(submissions)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(submissions.id, id));

    console.log(`[gateway] submission ${id} stopped by ${userId}`);
    return res.json({ submissionId: id, status: 'stopped' });
  } catch (err) {
    console.error('[gateway] stop error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to stop submission' });
  }
});
