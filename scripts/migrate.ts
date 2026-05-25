
import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`❌ Missing required environment variable: ${key}`);
  return value;
};

async function runMigrations() {
  const pool = new Pool({ connectionString: getEnv('TIMESCALE_URL') });

  try {
    const db = drizzle(pool);

    console.log('✅ Connected to TimescaleDB');
    console.log('🔄 Running pending migrations from infra/drizzle/ ...');

    await migrate(db, {
      migrationsFolder: path.join(__dirname, '../infra/drizzle'),
    });

    console.log('🚀 All migrations applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();

