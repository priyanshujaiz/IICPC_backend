import { Redis } from 'ioredis';
import { getEnv } from '@iicpc/shared';

// Singleton ioredis client — auto-reconnects on drop
const redis = new Redis(getEnv('REDIS_URL'), {
  maxRetriesPerRequest: null,  // required for blocking commands; harmless for ZADD
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  console.error('[telemetry:redis] connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[telemetry:redis] connected');
});

export { redis };

