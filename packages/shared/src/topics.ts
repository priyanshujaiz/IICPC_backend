// Kafka Topic Constants (Shared across all services)

export const TOPICS = {
    SUBMISSION_READY: 'submission.ready',
    SUBMISSION_STOPPED: 'submission.stopped',
    TELEMETRY_EVENTS: 'telemetry.events',
  } as const;
  
  export type Topic = typeof TOPICS[keyof typeof TOPICS];
  
  // Helper to get topic name (type-safe)
  export const getTopic = (key: keyof typeof TOPICS): Topic => TOPICS[key];