import pg from 'pg';
import { getEnv } from '@iicpc/shared';

const { Pool } = pg;

// Singleton pg pool — shared across flush cycles
const pool = new Pool({
  connectionString: getEnv('TIMESCALE_URL'),
  max: 5,              // small pool — 1 write per submission per second max
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[telemetry:db] unexpected pool error:', err.message);
});

export { pool };
