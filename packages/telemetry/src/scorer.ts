/**
 * Composite score formula — Phase 3.
 *
 * Weights:  40% latency  +  40% throughput  +  20% correctness
 * Normalization runs across ALL active submissions in the current flush cycle
 * so scores are relative (0–100 within the current round).
 */

function normalize(value: number, allValues: number[]): number {
  if (allValues.length < 2) return 50; // single submission → neutral score
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (max === min) return 50;          // all equal → neutral
  return ((value - min) / (max - min)) * 100;
}

/**
 * @param p99              This submission's p99 latency (ms) — lower is better
 * @param tps              This submission's TPS — higher is better
 * @param correctnessRate  0–100 fill accuracy
 * @param allP99s          p99 values of ALL currently active submissions
 * @param allTps           TPS values of ALL currently active submissions
 */
export function computeCompositeScore(
  p99: number,
  tps: number,
  correctnessRate: number,
  allP99s: number[],
  allTps: number[],
): number {
  // Latency: lower p99 = better → invert normalized value
  const latencyScore    = 100 - normalize(p99, allP99s);
  const throughputScore = normalize(tps, allTps);
  const correctScore    = correctnessRate; // already 0–100

  return (0.40 * latencyScore) + (0.40 * throughputScore) + (0.20 * correctScore);
}
