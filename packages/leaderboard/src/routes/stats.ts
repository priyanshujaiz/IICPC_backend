import { Router, Request, Response, IRouter } from 'express';
import { redis } from '../redis.js';
import { pool } from '../db.js';

const router: IRouter = Router();

/**
 * GET /stats
 * Returns platform-wide aggregate metrics across all active submissions.
 * Used by the Dashboard page KPI cards.
 */
router.get('/scores/stats', async (_req: Request, res: Response) => {
  try {
    // ── 1. Active submissions: count members of the leaderboard sorted set ─────
    const activeSubmissions = await redis.zcard('leaderboard');

    // ── 2. Total bots: 5 workers per active submission (matches BOT_COUNT env) ─
    const botCountPerSub = parseInt(process.env.BOT_COUNT ?? '5', 10);
    const totalBots = activeSubmissions * botCountPerSub;

    // ── 3. Per-submission live scores for aggregation ──────────────────────────
    const raw = await redis.zrevrangebyscore(
      'leaderboard', '+inf', '-inf', 'WITHSCORES', 'LIMIT', '0', '50'
    );

    let platformTps      = 0;
    let totalCorrectness = 0;
    let totalP99         = 0;
    let scoredCount      = 0;

    for (let i = 0; i < raw.length; i += 2) {
      const submissionId = raw[i];
      const scoreJson = await redis.get(`submission:${submissionId}:score`);
      if (scoreJson) {
        const s = JSON.parse(scoreJson);
        platformTps      += s.tps              ?? 0;
        totalCorrectness += s.correctnessRate  ?? 0;
        totalP99         += s.latencyP99       ?? 0;
        scoredCount++;
      }
    }

    const avgCorrectness = scoredCount > 0 ? totalCorrectness / scoredCount : 0;
    const avgLatencyP99  = scoredCount > 0 ? totalP99         / scoredCount : 0;

    // ── 4. Total orders processed in the last hour (from TimescaleDB) ──────────
    let totalOrders = 0;
    try {
      const result = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(total_orders), 0) AS total
         FROM metrics
         WHERE time > NOW() - INTERVAL '1 hour'`
      );
      totalOrders = Number(result.rows[0]?.total ?? 0);
    } catch {
      // metrics table may be empty during early startup — safe to return 0
    }

    res.json({
      activeSubmissions,
      totalBots,
      platformTps:    Math.round(platformTps),
      avgCorrectness: parseFloat(avgCorrectness.toFixed(1)),
      avgLatencyP99:  parseFloat(avgLatencyP99.toFixed(2)),
      totalOrders,
    });
  } catch (err) {
    console.error('[leaderboard] stats error:', (err as Error).message);
    res.status(500).json({ error: 'failed to fetch stats' });
  }
});

export { router as statsRouter };
