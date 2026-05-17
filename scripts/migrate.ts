// TimescaleDB Migration Runner — runs all files in infra/migrations/ in order
import 'dotenv/config';
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`❌ Missing required environment variable: ${key}`);
  return value;
};

async function runMigrations() {
  const client = new Client({ connectionString: getEnv('TIMESCALE_URL') });

  try {
    await client.connect();
    console.log('✅ Connected to TimescaleDB');

    const migrationsDir = path.join(process.cwd(), 'infra/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // alphabetical = numeric order: 001, 002, 003

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query(sql);
      console.log(`✅ Applied: ${file}`);
    }

    console.log('🚀 All migrations applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
