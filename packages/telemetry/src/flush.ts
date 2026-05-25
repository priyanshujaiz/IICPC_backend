import { getAllSubmissionIds, getPercentiles } from './histogram.js';
import { flushTps } from './tps-counter.js';
import { getOrCreateEngine } from './reference-engine.js';
import { computeCompositeScore } from './scorer.js';
import { pool } from './db.js';
import { redis } from './redis.js';

let timer: NodeJS.Timeout | null = null;

/**
 * Phase 3 flush — two-pass dual-write.
 *
 * Pass 1: collect { p50, p90, p99, tps, correctnessRate } for every active submission
 * Pass 2: normalize across all submissions → compositeScore per submission
 * Pass 3: INSERT metrics row to TimescaleDB  +  ZADD leaderboard to Redis
 *
 * DB / Redis errors are caught and logged — they NEVER crash the flush cycle.
 */
async function flushAll(): Promise<void> {
  const ids = getAllSubmissionIds();
  if (ids.length === 0) return;

  // ── Pass 1: collect raw metrics ──────────────────────────────────────────────
  type RawMetric = {
    submissionId: string;
    p50: number; p90: number; p99: number;
    tps: number;
    correctnessRate: number;
    totalOrders: number;
    correctFills: number;
    totalFills: number;
  };

  const metrics: RawMetric[] = [];

  for (const submissionId of ids) {
    const { p50, p90, p99, totalCount } = getPercentiles(submissionId);
    if (totalCount === 0) continue; // no data yet — skip

    const tps = flushTps(submissionId);
    const engine = getOrCreateEngine(submissionId);
    const correctnessRate = engine.getCorrectness();
    const { totalOrders, correctFills, totalFills } = engine.getCounters();

    metrics.push({ submissionId, p50, p90, p99, tps, correctnessRate, totalOrders, correctFills, totalFills });
  }

  if (metrics.length === 0) return;

  // ── Pass 2: normalize → composite scores ──────────────────────────────────────
  const allP99s = metrics.map(m => m.p99);
  const allTps  = metrics.map(m => m.tps);

  const scored = metrics.map(m => ({
    ...m,
    compositeScore: computeCompositeScore(m.p99, m.tps, m.correctnessRate, allP99s, allTps),
  }));

  // ── Pass 3: persist + console log ─────────────────────────────────────────────
  const now = new Date();

  for (const m of scored) {
    // Console log (kept from Phase 2)
    console.log(
      `[telemetry] ${m.submissionId.slice(0, 8)}  ` +
      `p50=${m.p50}ms  p90=${m.p90}ms  p99=${m.p99}ms  ` +
      `TPS=${m.tps}  correctness=${m.correctnessRate.toFixed(1)}%  score=${m.compositeScore.toFixed(2)}`
    );

    // TimescaleDB INSERT
    try {
      await pool.query(
        `INSERT INTO metrics
           (time, submission_id, latency_p50, latency_p90, latency_p99,
            tps, correctness_rate, composite_score,
            total_orders, correct_fills, total_fills)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          now,
          m.submissionId,
          m.p50, m.p90, m.p99,
          m.tps,
          m.correctnessRate,
          m.compositeScore,
          m.totalOrders,
          m.correctFills,
          m.totalFills,
        ]
      );
    } catch (err) {
      console.error(`[telemetry:db] INSERT failed for ${m.submissionId.slice(0, 8)}:`, (err as Error).message);
    }

    // Redis: ZADD leaderboard + SET score JSON
    try {
      const scoreJson = JSON.stringify({
        submissionId: m.submissionId,
        latencyP50: m.p50,
        latencyP90: m.p90,
        latencyP99: m.p99,
        tps: m.tps,
        correctnessRate: m.correctnessRate,
        compositeScore: m.compositeScore,
      });

      await redis.zadd('leaderboard', m.compositeScore, m.submissionId);
      await redis.set(`submission:${m.submissionId}:score`, scoreJson, 'EX', 86400);
    } catch (err) {
      console.error(`[telemetry:redis] write failed for ${m.submissionId.slice(0, 8)}:`, (err as Error).message);
    }
  }
}

export function startFlushCycle(): void {
  if (timer) return; // guard against double-start
  timer = setInterval(() => {
    flushAll().catch(err => console.error('[telemetry] flush error:', err));
  }, 1_000);
  console.log('[telemetry] flush cycle started (1s interval)');
}

export function stopFlushCycle(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[telemetry] flush cycle stopped');
  }
}

