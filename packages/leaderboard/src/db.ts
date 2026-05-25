import pg from 'pg';
import { getEnv } from '@iicpc/shared';

const { Pool } = pg;

// Read-only pool — leaderboard only queries, never writes to TimescaleDB
const pool = new Pool({
  connectionString: getEnv('TIMESCALE_URL'),
  max: 3,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err: Error) => {
  console.error('[leaderboard:db] pool error:', err.message);
});

export { pool };
