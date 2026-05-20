import { createProducer,TOPICS, getEnv } from '@iicpc/shared';
import type { SubmissionReadyEvent, SubmissionStoppedEvent } from '@iicpc/shared';

const brokers = getEnv('KAFKA_BROKERS').split(',');
const producer = createProducer(brokers);
let connected = false;


async function ensureConnected() {
  if (!connected) {
    await producer.connect();
    connected = true;
    console.log('[sandbox] Kafka producer connected');
  }
}

/**
 * Publishes submission.ready → bot-fleet picks this up to start firing bots.
 */
export async function publishSubmissionReady(event: SubmissionReadyEvent): Promise<void> {
    await ensureConnected();
    await producer.send({
      topic: TOPICS.SUBMISSION_READY,
      messages: [{ key: event.submissionId, value: JSON.stringify(event) }],
    });
    console.log(`[sandbox] published submission.ready for ${event.submissionId}`);
  }
  /**
   * Publishes submission.stopped → bot-fleet tears down workers for this submission.
   */
  export async function publishSubmissionStopped(event: SubmissionStoppedEvent): Promise<void> {
    await ensureConnected();
    await producer.send({
      topic: TOPICS.SUBMISSION_STOPPED,
      messages: [{ key: event.submissionId, value: JSON.stringify(event) }],
    });
    console.log(`[sandbox] published submission.stopped for ${event.submissionId}`);
  }
  /**
   * Graceful shutdown — call on SIGTERM.
   */
  export async function disconnectProducer(): Promise<void> {
    if (connected) {
      await producer.disconnect();
      console.log('[sandbox] Kafka producer disconnected');
    }
  }