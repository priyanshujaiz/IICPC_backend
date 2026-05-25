import type { TelemetryEvent } from '@iicpc/shared';

interface Counters {
  correct: number;
  total: number;
  totalOrders: number;
}

/**
 * In-process reference matching engine per submission.
 *
 * Validates MARKET order fills only.
 * LIMIT and CANCEL orders are counted toward totalOrders but not validated
 * (full book replay would be required — out of scope for Phase 3).
 *
 * Ordering non-determinism: parallel bot threads may fire orders in a
 * different sequence than we see them. Never hard-crash on divergence — log
 * and count. If total market orders < 10, report 100% (insufficient sample).
 */
class ReferenceEngine {
  private counters: Counters = { correct: 0, total: 0, totalOrders: 0 };

  processEvent(event: TelemetryEvent): void {
    this.counters.totalOrders++;

    if (event.orderType !== 'MARKET') return; // LIMIT / CANCEL — skip validation

    const matches = event.filled === event.expectedFill;
    if (matches) {
      this.counters.correct++;
    } else {
      console.warn(
        `[reference-engine] fill mismatch orderId=${event.orderId} ` +
        `expected=${event.expectedFill} actual=${event.filled}`
      );
    }
    this.counters.total++;
  }

  /** Returns 0–100. Returns 100 if fewer than 10 market orders seen. */
  getCorrectness(): number {
    if (this.counters.total < 10) return 100;
    return (this.counters.correct / this.counters.total) * 100;
  }

  getCounters(): { totalOrders: number; correctFills: number; totalFills: number } {
    return {
      totalOrders: this.counters.totalOrders,
      correctFills: this.counters.correct,
      totalFills: this.counters.total,
    };
  }

  reset(): void {
    this.counters = { correct: 0, total: 0, totalOrders: 0 };
  }
}

// ── Per-submission registry ────────────────────────────────────────────────────

const engines = new Map<string, ReferenceEngine>();

export function getOrCreateEngine(submissionId: string): ReferenceEngine {
  if (!engines.has(submissionId)) {
    engines.set(submissionId, new ReferenceEngine());
  }
  return engines.get(submissionId)!;
}

export function resetEngine(submissionId: string): void {
  engines.get(submissionId)?.reset();
  engines.delete(submissionId);
}

export function getAllEngineIds(): string[] {
  return [...engines.keys()];
}
