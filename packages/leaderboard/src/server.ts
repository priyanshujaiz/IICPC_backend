import { app } from './app.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { getEnvNumber } from '@iicpc/shared';

const PORT = getEnvNumber('LEADERBOARD_PORT', 4001);

/**
 * On startup: if the Redis leaderboard sorted set is empty, rebuild it from
 * the latest composite_score per submission stored in TimescaleDB.
 *
 * This handles the case where Redis was restarted mid-contest — without this,
 * the leaderboard would appear empty until telemetry flushes new scores.
 */
async function rebuildLeaderboardFromDb(): Promise<void> {
  const count = await redis.zcard('leaderboard');
  if (count > 0) {
    console.log(`[leaderboard] Redis leaderboard already has ${count} entries — skipping rebuild`);
    return;
  }

  console.log('[leaderboard] Redis leaderboard is empty — rebuilding from TimescaleDB...');

  const result = await pool.query(`
    SELECT DISTINCT ON (submission_id)
      submission_id,
      composite_score,
      latency_p50,
      latency_p90,
      latency_p99,
      tps,
      correctness_rate
    FROM metrics
    ORDER BY submission_id, time DESC
  `);

  if (result.rows.length === 0) {
    console.log('[leaderboard] No metrics in DB yet — leaderboard will populate as telemetry flushes');
    return;
  }

  // Rebuild both the sorted set and the score JSON keys
  for (const row of result.rows) {
    await redis.zadd('leaderboard', row.composite_score, row.submission_id);
    await redis.set(
      `submission:${row.submission_id}:score`,
      JSON.stringify({
        submissionId: row.submission_id,
        latencyP50: row.latency_p50,
        latencyP90: row.latency_p90,
        latencyP99: row.latency_p99,
        tps: row.tps,
        correctnessRate: row.correctness_rate,
        compositeScore: row.composite_score,
      }),
      'EX',
      86400
    );
  }

  console.log(`[leaderboard] Rebuilt ${result.rows.length} entries from TimescaleDB`);
}

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`[leaderboard] listening on port ${PORT}`);

  try {
    await rebuildLeaderboardFromDb();
  } catch (err) {
    // Non-fatal — leaderboard will populate normally as telemetry flushes
    console.error('[leaderboard] Redis rebuild failed:', (err as Error).message);
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[leaderboard] SIGTERM received — shutting down');
  server.close(() => {
    pool.end();
    redis.quit();
    process.exit(0);
  });
});
