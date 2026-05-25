import { Router, Request, Response, IRouter } from 'express';
import { redis } from '../redis.js';

const router: IRouter = Router();

/**
 * Fetches current leaderboard from Redis sorted set.
 * Returns ranked array of LiveScore objects enriched with submission metadata.
 */
async function getLeaderboardPayload(): Promise<object[]> {
  // ZREVRANGEBYSCORE: highest score first, top 50
  const raw = await redis.zrevrangebyscore(
    'leaderboard', '+inf', '-inf',
    'WITHSCORES',
    'LIMIT', '0', '50'
  );

  const entries: object[] = [];

  // raw = [submissionId, score, submissionId, score, ...]
  for (let i = 0; i < raw.length; i += 2) {
    const submissionId = raw[i];
    const compositeScore = parseFloat(raw[i + 1]);
    const rank = (i / 2) + 1;

    // Fetch the full score JSON snapshot stored by telemetry
    const scoreJson = await redis.get(`submission:${submissionId}:score`);
    const scoreData = scoreJson ? JSON.parse(scoreJson) : {};

    // Fetch submission metadata (contestantId, language, submittedAt)
    const meta = await redis.hgetall(`submission:${submissionId}:meta`);

    // Fetch live status
    const status = await redis.get(`submission:${submissionId}:status`);

    entries.push({
      rank,
      submissionId,
      compositeScore,
      contestantId: meta?.username ?? meta?.contestantId ?? 'unknown',  // human name
      language:     meta?.language     ?? 'unknown',
      submittedAt:  meta?.submittedAt  ? Number(meta.submittedAt) : null,
      status:       status             ?? 'unknown',
      ...scoreData,
    });
  }

  return entries;
}

// ── GET /scores/snapshot — one-shot leaderboard (for initial page load) ───────
router.get('/scores/snapshot', async (_req: Request, res: Response) => {
  try {
    const payload = await getLeaderboardPayload();
    res.json(payload);
  } catch (err) {
    console.error('[leaderboard] snapshot error:', (err as Error).message);
    res.status(500).json({ error: 'failed to fetch leaderboard' });
  }
});

export { router as snapshotRouter, getLeaderboardPayload };
