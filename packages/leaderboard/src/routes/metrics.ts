import { Router, Request, Response, IRouter } from 'express';
import { pool } from '../db.js';

const router: IRouter = Router();

/**
 * GET /metrics/:submissionId
 * Returns last 5 minutes of time-series data for a submission.
 * Used by the frontend to render latency/TPS charts.
 */
router.get('/metrics/:submissionId', async (req: Request, res: Response) => {
  const { submissionId } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         time,
         latency_p50,
         latency_p90,
         latency_p99,
         tps,
         correctness_rate,
         composite_score
       FROM metrics
       WHERE submission_id = $1
         AND time > NOW() - INTERVAL '5 minutes'
       ORDER BY time ASC`,
      [submissionId]
    );

    const dataPoints = result.rows.map(row => ({
      time: row.time,
      latencyP50: row.latency_p50,
      latencyP90: row.latency_p90,
      latencyP99: row.latency_p99,
      tps: row.tps,
      correctnessRate: row.correctness_rate,
      compositeScore: row.composite_score,
    }));

    res.json({ submissionId, dataPoints });
  } catch (err) {
    console.error('[leaderboard] metrics query error:', (err as Error).message);
    res.status(500).json({ error: 'failed to fetch metrics' });
  }
});

export { router as metricsRouter };
