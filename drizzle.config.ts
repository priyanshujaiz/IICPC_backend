// drizzle.config.ts — root level
// Used by drizzle-kit CLI:
//   pnpm drizzle-kit generate   → reads schema, generates SQL migration files
//   pnpm drizzle-kit migrate    → applies pending migrations to DB
//   pnpm drizzle-kit studio     → opens visual DB browser on localhost:4983

import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Where the Drizzle schema lives
  schema: './packages/shared/src/schema.ts',

  // Where drizzle-kit will write generated migration SQL files
  // We put them alongside the existing hand-written SQL migrations
  out: './infra/drizzle',

  // We use node-postgres (pg) driver
  dialect: 'postgresql',

  dbCredentials: {
    url: process.env.TIMESCALE_URL!,
  },

  // Print all SQL statements as they run
  verbose: true,

  // Throw on breaking changes (safety net — forces explicit acknowledgement)
  strict: true,
});
