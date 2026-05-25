import { Pool } from 'pg';
import { createDb } from '@iicpc/shared';
import { getEnv } from '@iicpc/shared';

// Single pg pool shared across all gateway routes
const pool = new Pool({
  connectionString: getEnv('TIMESCALE_URL'),
  max: 5, // gateway only does auth + submit DB writes — small pool is fine
});

export const db = createDb(pool);
