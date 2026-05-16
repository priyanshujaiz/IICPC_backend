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
│   └── shared/               # Shared TypeScript types, Kafka topics, helpers
│       └── src/
│           ├── types.ts       # Core domain types (Submission, TelemetryEvent, LiveScore)
│           ├── topics.ts      # Kafka topic name constants
│           ├── kafka.ts       # Kafka producer/consumer factory helpers
│           ├── errors.ts      # Typed error classes
│           ├── config.ts      # getEnv() / getEnvNumber() helpers
│           └── index.ts       # Barrel export
├── infra/
│   ├── docker-compose.yml     # Redpanda, TimescaleDB, Redis, MinIO
│   ├── docker-compose.override.yml
│   └── migrations/
│       └── 001_init.sql       # TimescaleDB metrics hypertable
├── scripts/
│   ├── migrate.ts             # Run database migrations
│   └── wait-for-infra.sh      # Wait until all containers are healthy
├── docs/
│   ├── blueprint.md           # Full system architecture blueprint
│   └── phase-planner.md       # Implementation roadmap
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

This creates the `metrics` hypertable in TimescaleDB.

### 6. Build shared package

```bash
pnpm build
```

## Verifying the Setup

**Check TimescaleDB table:**
```bash
docker exec iicpc-timescale psql -U postgres -d iicpc -c "\d metrics"
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
