import { Router } from 'express';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { getEnv } from '@iicpc/shared';
import { submissions } from '@iicpc/shared';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';

export const runsRouter: Router = Router();
const redis = new Redis(getEnv('REDIS_URL'));

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
