import { Redis } from 'ioredis';
import { getEnv } from '@iicpc/shared';

// Read-only Redis client — leaderboard only reads ZRANGEBYSCORE + GET
const redis = new Redis(getEnv('REDIS_URL'), {
  maxRetriesPerRequest: null,
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  console.error('[leaderboard:redis] connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[leaderboard:redis] connected');
});

export { redis };
