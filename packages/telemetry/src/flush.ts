import { getAllSubmissionIds, getPercentiles } from './histogram.js';
import { flushTps } from './tps-counter.js';

let timer: NodeJS.Timeout | null = null;

/**
 * Phase 2: console-only flush.
 * Phase 3 will extend this to write to TimescaleDB + Redis ZADD.
 */
function flushAll(): void {
  const ids = getAllSubmissionIds();
  if (ids.length === 0) return;

  for (const submissionId of ids) {
    const { p50, p90, p99, totalCount } = getPercentiles(submissionId);
    const tps = flushTps(submissionId);

    if (totalCount === 0) continue; // skip submissions with no data yet

    console.log(
      `[telemetry] ${submissionId.slice(0, 8)}  ` +
      `p50=${p50}ms  p90=${p90}ms  p99=${p99}ms  TPS=${tps}`
    );
  }
}

export function startFlushCycle(): void {
  if (timer) return; // already running — guard against double-start
  timer = setInterval(flushAll, 1_000);
  console.log('[telemetry] flush cycle started (1s interval)');
}

export function stopFlushCycle(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[telemetry] flush cycle stopped');
  }
}
