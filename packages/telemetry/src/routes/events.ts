import type { FastifyInstance } from "fastify";
import type { TelemetryEvent } from '@iicpc/shared';

import { recordsLatency } from "../histogram.js";
import { recordEvent } from "../tps-counter.js";

/**
 * Processes a single telemetry event — records latency + increments TPS counter.
 */
function ingest(event: TelemetryEvent): void {
  const latencyMs = event.ackedAt - event.sentAt;
  recordsLatency(event.submissionId, latencyMs);
  recordEvent(event.submissionId);
}

export async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Single event (fallback path) ─────────────────────────────────────────
  fastify.post<{ Body: TelemetryEvent }>('/events', async (req, reply) => {
    ingest(req.body);
    return reply.status(202).send({ ok: true });
  });
  // ── Batch (preferred — 50 events per call from bot workers) ──────────────
  fastify.post<{ Body: TelemetryEvent[] }>('/events/batch', async (req, reply) => {
    const batch = req.body;
    if (!Array.isArray(batch)) {
      return reply.status(400).send({ error: 'body must be an array' });
    }
    for (const event of batch) {
      ingest(event);
    }
    return reply.status(202).send({ ok: true, count: batch.length });
  });
}