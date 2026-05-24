import Fastify from 'fastify';
import { getEnvNumber } from '@iicpc/shared';
import { eventsRoutes } from './routes/events.js';
import { startFlushCycle, stopFlushCycle } from './flush.js';

const fastify = Fastify({ logger: false });

// ── Health probe ──────────────────────────────────────────────────────────────
fastify.get('/health', async (_req, reply) => {
  return reply.send({ status: 'ok', uptime: process.uptime() });
});

// ── Telemetry routes ──────────────────────────────────────────────────────────
fastify.register(eventsRoutes);

// ── Startup ───────────────────────────────────────────────────────────────────
const PORT = getEnvNumber('TELEMETRY_PORT', 4000);

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[telemetry] listening on port ${PORT}`);
    startFlushCycle();
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
