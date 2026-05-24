import { workerData, isMainThread } from 'worker_threads';
import axios from 'axios';
import type { TelemetryEvent } from '@iicpc/shared';
import { generateOrder } from './scenario.js';

if (isMainThread) {
  throw new Error('bot-worker must be run as a worker thread, not directly');
}

interface BotConfig {
  submissionId: string;
  targetHost: string;
  targetPort: number;
  botId: number;
  lambda: number;
  telemetryUrl: string;
}

const config = workerData as BotConfig;
const TARGET_URL = `http://${config.targetHost}:${config.targetPort}`;
const BATCH_URL  = `${config.telemetryUrl}/events/batch`;
const BATCH_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function poissonDelay(lambda: number): number {
  return (-Math.log(Math.random()) / lambda) * 1000; // ms
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Telemetry batch buffer ────────────────────────────────────────────────────

const buffer: TelemetryEvent[] = [];

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await axios.post(BATCH_URL, batch, { timeout: 2_000 });
  } catch {
    // Never crash the bot on telemetry failure — silently drop
  }
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

let consecutiveFailures = 0;
const BREAKER_THRESHOLD = 10;
const BREAKER_WAIT_MS   = 5_000;

// ── Bot loop ──────────────────────────────────────────────────────────────────

async function botLoop(): Promise<void> {
  console.log(`[bot-${config.botId}] started → ${TARGET_URL}`);

  while (true) {
    // Circuit breaker: if exchange is down, pause before retrying
    if (consecutiveFailures >= BREAKER_THRESHOLD) {
      console.warn(`[bot-${config.botId}] circuit open — waiting ${BREAKER_WAIT_MS}ms`);
      await sleep(BREAKER_WAIT_MS);
      consecutiveFailures = 0;
    }

    await sleep(poissonDelay(config.lambda));

    const order  = generateOrder(1000);
    const sentAt = performance.now();

    try {
      const response = await axios.post(
        `${TARGET_URL}/order`,
        order,
        { timeout: 5_000 }
      );
      const ackedAt = performance.now();
      consecutiveFailures = 0;

      const filledQty = (response.data?.filledQty as number) ?? 0;

      buffer.push({
        submissionId: config.submissionId,
        orderId:      order.orderId,
        sentAt,
        ackedAt,
        orderType:    order.type,
        filled:       filledQty,
        expectedFill: 0, // Phase 3: reference engine will fill this in
      });

      if (buffer.length >= BATCH_SIZE) {
        await flushBuffer();
      }
    } catch {
      consecutiveFailures++;
      // Failed orders are not pushed to telemetry
    }
  }
}

// Final flush when the worker is terminated
process.on('exit', () => { flushBuffer(); });

botLoop().catch((err) => {
  console.error(`[bot-${config.botId}] fatal:`, err);
  process.exit(1);
});
