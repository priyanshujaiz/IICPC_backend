# IICPC Platform

Distributed Benchmarking & Hosting Platform — IICPC Summer Hackathon 2026.

## Prerequisites

- [Node.js v20+](https://nodejs.org/)
- [pnpm v10+](https://pnpm.io/installation)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Project Structure

```
iicpc-platform/
├── packages/
│   └── shared/               # Shared TypeScript types, Kafka topics, DB helpers
│       └── src/
│           ├── schema.ts      # Drizzle table definitions (submissions + metrics)
│           ├── db.ts          # createDb() factory — wraps pg Pool with Drizzle
│           ├── types.ts       # Core domain types (Submission, TelemetryEvent, LiveScore)
│           ├── topics.ts      # Kafka topic name constants
│           ├── kafka.ts       # Kafka producer/consumer factory helpers
│           ├── errors.ts      # Typed error classes
│           ├── config.ts      # getEnv() / getEnvNumber() helpers
│           └── index.ts       # Barrel export
├── infra/
│   ├── docker-compose.yml     # Redpanda, TimescaleDB, Redis, MinIO
│   ├── docker-compose.override.yml
│   └── drizzle/               # Drizzle-managed migration files (auto-tracked)
│       ├── 0000_*.sql         # CREATE TABLE submissions + metrics (generated)
│       └── 0001_hypertable.sql # create_hypertable() + indexes (hand-written)
├── scripts/
│   ├── migrate.ts             # Run database migrations via Drizzle migrator
│   └── wait-for-infra.sh      # Wait until all containers are healthy
├── docs/
│   ├── blueprint.md           # Full system architecture blueprint
│   ├── database-design.md     # Three-store schema reference (TimescaleDB · Redis · MinIO)
│   └── phase-planner.md       # Implementation roadmap
├── drizzle.config.ts          # Drizzle-kit config (schema path, migrations output, DB URL)
├── .env.example               # Environment variable template
├── tsconfig.base.json         # Shared TypeScript config
├── turbo.json                 # Turborepo task pipeline
└── pnpm-workspace.yaml        # Workspace package declarations
```

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

The default values in `.env.example` work as-is for local development. No changes needed.

### 3. Start infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:
- **Redpanda** (Kafka-compatible broker) on port `19092`
- **TimescaleDB** (PostgreSQL + time-series) on port `5433`
- **Redis** on port `6379`
- **MinIO** (S3-compatible object store) on ports `9000` / `9001`

### 4. Wait for all containers to be healthy

```bash
bash scripts/wait-for-infra.sh
```

Expected output:
```
✅ Redpanda healthy
✅ Timescale healthy
✅ Redis healthy
✅ MinIO healthy
🚀 All infrastructure services are healthy!
```

### 5. Run database migrations

```bash
pnpm migrate
```

This applies all pending migrations from `infra/drizzle/` in order:
- Creates the `submissions` table and `metrics` table
- Converts `metrics` into a TimescaleDB hypertable (partitioned by time)
- Creates all query indexes

Drizzle tracks which migrations have already run in a `__drizzle_migrations` table — safe to re-run at any time.

### 5a. Database commands reference

| Command | What it does |
|---|---|
| `pnpm migrate` | Apply all pending migrations to TimescaleDB |
| `pnpm db:generate` | Generate a new migration file after changing `schema.ts` |
| `pnpm db:studio` | Open Drizzle Studio (visual DB browser) at `localhost:4983` |
| `pnpm db:push` | Push schema directly to DB without a migration file (dev only) |

### 6. Build shared package

```bash
pnpm build
```

## Verifying the Setup

**Check TimescaleDB tables:**
```bash
# List all tables
docker exec iicpc-timescale psql -U postgres -d iicpc -c "\dt"

# Confirm metrics is a hypertable
docker exec iicpc-timescale psql -U postgres -d iicpc -c \
  "SELECT hypertable_name FROM timescaledb_information.hypertables;"

# Confirm submissions table columns
docker exec iicpc-timescale psql -U postgres -d iicpc -c "\d submissions"
```

**Open Drizzle Studio (visual DB browser):**
```bash
pnpm db:studio
# Open http://localhost:4983 in your browser
```

**Check Redis:**
```bash
docker exec iicpc-redis redis-cli ping
# Expected: PONG
```

**Check MinIO console:**

Open [http://localhost:9001](http://localhost:9001) in your browser.
Login: `minioadmin` / `minioadmin123`

## Stopping Infrastructure

```bash
docker compose -f infra/docker-compose.yml down
```

To also remove all stored data (full reset):
```bash
docker compose -f infra/docker-compose.yml down -v
```
