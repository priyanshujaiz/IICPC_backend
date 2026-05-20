import { Router } from 'express';
import Redis from 'ioredis';
import { getEnv } from '@iicpc/shared';
import { requireAuth } from '../middleware/auth.js';

export const runsRouter:Router = Router();

const redis = new Redis(getEnv('REDIS_URL'));

// GET /runs/:id  — returns submission status from Redis
// Requires valid JWT
runsRouter.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  const status = await redis.get(`submission:${id}:status`);
  if (!status) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }

  const meta = await redis.hgetall(`submission:${id}:meta`);

  res.json({ submissionId: id, status, ...meta });
});
