import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import { createConsumer, TOPICS, getEnv, getEnvNumber } from '@iicpc/shared';
import type { SubmissionReadyEvent, SubmissionStoppedEvent } from '@iicpc/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const brokers = getEnv('KAFKA_BROKERS').split(',');
const BOT_COUNT = getEnvNumber('BOT_COUNT', 10);
const BOT_LAMBDA = getEnvNumber('BOT_LAMBDA', 10);
const TELEMETRY_URL = getEnv('TELEMETRY_URL');

// ── Worker pool ───────────────────────────────────────────────────────────────
// Map<submissionId, Worker[]>  — tracks all active bot threads per submission
const activeFleets = new Map<string, Worker[]>();

function spawnWorker(config: {
  submissionId: string;
  targetHost: string;
  targetPort: number;
  botId: number;
  lambda: number;
  telemetryUrl: string;
}): Worker {
  const workerPath = path.join(__dirname, 'bot-worker.js');

  const worker = new Worker(workerPath, {
    workerData: config,
    // lets tsx handle the .ts worker file during dev
    execArgv: ['--import', 'tsx'],
  });

  worker.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bot-fleet] worker ${config.botId} error for ${config.submissionId}:`,
      message,
    );
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[bot-fleet] worker ${config.botId} exited with code ${code}`);
    }
  });

  return worker;
}

function startFleet(event: SubmissionReadyEvent): void {
  if (activeFleets.has(event.submissionId)) {
    console.warn(`[bot-fleet] fleet already running for ${event.submissionId} — skipping`);
    return;
  }

  console.log(`[bot-fleet] spawning ${BOT_COUNT} workers for ${event.submissionId} → ${event.host}:${event.port}`);

  const workers: Worker[] = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    const worker = spawnWorker({
      submissionId: event.submissionId,
      targetHost: event.host,
      targetPort: event.port,
      botId: i,
      lambda: BOT_LAMBDA,
      telemetryUrl: TELEMETRY_URL,
    });
    workers.push(worker);
  }

  activeFleets.set(event.submissionId, workers);
  console.log(`[bot-fleet] ${BOT_COUNT} workers started for ${event.submissionId}`);
}

async function stopFleet(submissionId: string): Promise<void> {
  const workers = activeFleets.get(submissionId);
  if (!workers) return;

  console.log(`[bot-fleet] stopping ${workers.length} workers for ${submissionId}`);
  await Promise.all(workers.map((w) => w.terminate()));
  activeFleets.delete(submissionId);
  console.log(`[bot-fleet] fleet terminated for ${submissionId}`);
}

// ── Kafka consumers ───────────────────────────────────────────────────────────
async function run(): Promise<void> {
  const consumer = createConsumer(brokers, 'bot-fleet-group');
  await consumer.connect();

  await consumer.subscribe({ topics: [TOPICS.SUBMISSION_READY, TOPICS.SUBMISSION_STOPPED], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const raw = message.value?.toString();
      if (!raw) return;

      try {
        if (topic === TOPICS.SUBMISSION_READY) {
          const event = JSON.parse(raw) as SubmissionReadyEvent;
          startFleet(event);
        }

        if (topic === TOPICS.SUBMISSION_STOPPED) {
          const event = JSON.parse(raw) as SubmissionStoppedEvent;
          await stopFleet(event.submissionId);
        }
      } catch (err) {
        // Never crash the consumer — log and continue
        console.error(`[bot-fleet] failed to process message on ${topic}:`, err);
      }
    },
  });

  console.log('[bot-fleet] orchestrator running — waiting for Kafka events');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  process.on('SIGTERM', async () => {
    console.log('[bot-fleet] SIGTERM — draining workers');
    const allIds = [...activeFleets.keys()];
    await Promise.all(allIds.map(stopFleet));
    await consumer.disconnect();
    console.log('[bot-fleet] shutdown complete');
    process.exit(0);
  });
}

run().catch((err) => {
  console.error('[bot-fleet] fatal startup error:', err);
  process.exit(1);
});
