// TimescaleDB Migration Runner
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
  const client = new Client({
    connectionString: getEnv('TIMESCALE_URL'),
  });

  try {
    await client.connect();
    console.log('✅ Connected to TimescaleDB');

    const migrationPath = path.join(process.cwd(), 'infra/migrations/001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    await client.query(sql);
    console.log('✅ Migration 001_init.sql applied successfully');
    console.log('✅ metrics hypertable is ready');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();