import Fastify from 'fastify';
import { getEnv, getEnvNumber, createConsumer, TOPICS } from '@iicpc/shared';
import { eventsRoutes } from './routes/events.js';
import { startFlushCycle, stopFlushCycle } from './flush.js';
import { resetEngine } from './reference-engine.js';
import { removeHistogram } from './histogram.js';
import { removeTpsWindow } from './tps-counter.js';
import { redis } from './redis.js';

const fastify = Fastify({ logger: false });

// ── Health probe ──────────────────────────────────────────────────────────────
fastify.get('/health', async (_req, reply) => {
  return reply.send({ status: 'ok', uptime: process.uptime() });
});

// ── Telemetry routes ──────────────────────────────────────────────────────────
fastify.register(eventsRoutes);

// ── Kafka consumer: submission.stopped ───────────────────────────────────────
async function startStopConsumer(): Promise<void> {
  const brokers = getEnv('KAFKA_BROKERS').split(',');
  const consumer = createConsumer(brokers, 'telemetry-stop-listener');
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.SUBMISSION_STOPPED, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const raw = message.value?.toString();
        if (!raw) return;
        const { submissionId } = JSON.parse(raw) as { submissionId: string };

        console.log(`[telemetry] submission stopped: ${submissionId.slice(0, 8)} — cleaning up`);

        // Remove from Redis leaderboard
        await redis.zrem('leaderboard', submissionId);
        await redis.del(`submission:${submissionId}:score`);

        // Clean up in-process state
        resetEngine(submissionId);
        removeHistogram(submissionId);
        removeTpsWindow(submissionId);
      } catch (err) {
        console.error('[telemetry] stop consumer error:', (err as Error).message);
      }
    },
  });

  console.log('[telemetry] Kafka stop consumer ready');
}

// ── Startup ───────────────────────────────────────────────────────────────────
const PORT = getEnvNumber('TELEMETRY_PORT', 4000);

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[telemetry] listening on port ${PORT}`);
    startFlushCycle();

    // Start Kafka consumer (non-blocking — don't crash server if Kafka is down)
    startStopConsumer().catch(err =>
      console.error('[telemetry] Kafka stop consumer failed to start:', err.message)
    );
  } catch (err) {
    console.error('[telemetry] failed to start:', err);
    process.exit(1);
  }
};

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[telemetry] SIGTERM received — shutting down');
  stopFlushCycle();
  await fastify.close();
  process.exit(0);
});

start();

