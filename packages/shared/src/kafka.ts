// Kafka Factory Helpers (Shared across all services)

import { Kafka, Producer, Consumer } from 'kafkajs';

export const createProducer = (brokers: string[]): Producer => {
  const kafka = new Kafka({
    brokers,
    clientId: 'iicpc-producer',
    retry: {
      initialRetryTime: 100,
      retries: 8,
    },
  });
  return kafka.producer();
};

export const createConsumer = (brokers: string[], groupId: string): Consumer => {
  const kafka = new Kafka({
    brokers,
    clientId: 'iicpc-consumer',
    retry: {
      initialRetryTime: 100,
      retries: 8,
    },
  });
  return kafka.consumer({ groupId });
};