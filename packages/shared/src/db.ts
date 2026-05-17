// createDb() — call this once per service at startup, pass in a pg Pool.

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;


export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
