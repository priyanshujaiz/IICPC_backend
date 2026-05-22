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
│   ├── shared/                    # Shared TypeScript types, Kafka topics, DB helpers
│   │   └── src/
│   │       ├── schema.ts          # Drizzle table definitions (submissions + metrics)
│   │       ├── db.ts              # createDb() factory — wraps pg Pool with Drizzle
│   │       ├── types.ts           # Core domain types (Submission, TelemetryEvent, LiveScore)
│   │       ├── topics.ts          # Kafka topic name constants
│   │       ├── kafka.ts           # Kafka producer/consumer factory helpers
│   │       ├── errors.ts          # Typed error classes
│   │       ├── config.ts          # getEnv() / getEnvNumber() helpers
│   │       └── index.ts           # Barrel export
│   └── gateway/                   # API Gateway — auth, upload, status routing
│       └── src/
│           ├── app.ts             # Express app — middleware chain (helmet→rate-limit→cors→json)
│           ├── server.ts          # HTTP listen entry point + MinIO bucket setup on startup
│           ├── setup.ts           # ensureInfrastructure() — creates MinIO bucket if missing
│           ├── middleware/
│           │   └── auth.ts        # requireAuth() — JWT verify middleware
│           └── routes/
│               ├── health.ts      # GET /health — k8s liveness probe
│               ├── auth.ts        # POST /auth/login — issue signed JWT
│               ├── submit.ts      # POST /submit — multer-s3 stream to MinIO + Redis meta
│               └── runs.ts        # GET /runs/:id — submission status from Redis
├── infra/
│   ├── docker-compose.yml         # Redpanda, TimescaleDB, Redis, MinIO
│   ├── docker-compose.override.yml
│   └── drizzle/                   # Drizzle-managed migration files (auto-tracked)
│       ├── 0000_*.sql             # CREATE TABLE submissions + metrics (generated)
│       └── 0001_hypertable.sql    # create_hypertable() + indexes (hand-written)
├── scripts/
│   ├── migrate.ts                 # Run database migrations via Drizzle migrator
│   └── wait-for-infra.sh          # Wait until all containers are healthy
├── docs/
│   ├── blueprint.md               # Full system architecture blueprint
│   ├── database-design.md         # Three-store schema reference (TimescaleDB · Redis · MinIO)
│   └── phase-planner.md           # Implementation roadmap
├── drizzle.config.ts              # Drizzle-kit config (schema path, migrations output, DB URL)
├── .env.example                   # Environment variable template
├── tsconfig.base.json             # Shared TypeScript config
├── turbo.json                     # Turborepo task pipeline
└── pnpm-workspace.yaml            # Workspace package declarations
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

### 7. Start the Gateway (Phase 1)

```bash
cd packages/gateway
pnpm dev
```

Expected output:
```
[gateway] MinIO bucket "submissions" created (or already exists)
[gateway] listening on port 3000
```

---

## Environment Variables

All variables live in `.env` at the project root. Copy from `.env.example`:

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `supersecretdev` | Secret key for signing JWT tokens |
| `ADMIN_USERNAME` | `admin` | Username for `POST /auth/login` |
| `ADMIN_PASSWORD` | `admin123` | Password for `POST /auth/login` |
| `PORT` | `3000` | Gateway HTTP port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `KAFKA_BROKERS` | `localhost:19092` | Redpanda/Kafka broker addresses |
| `MINIO_ENDPOINT` | `http://localhost:9000` | MinIO endpoint URL (full URL including port) |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO secret key |
| `TIMESCALE_URL` | `postgresql://postgres:postgres@localhost:5433/iicpc` | TimescaleDB connection string |
| `BOT_COUNT` | `50` | Number of bot workers per submission |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin |

---

## Gateway API Reference

Base URL: `http://localhost:3000`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness probe — returns `{ status, uptime }` |
| `POST` | `/auth/login` | None | Returns signed JWT — body: `{ username, password }` |
| `POST` | `/submit` | Bearer JWT | Upload code zip — body: `multipart/form-data` field `file` + `language` |
| `GET` | `/runs/:id` | Bearer JWT | Returns submission status + metadata from Redis |

### Postman Test Sequence

**1. Health check — no auth needed**
```
GET http://localhost:3000/health
```
Expected: `{ "status": "ok", "uptime": 3.4 }`

**2. Get a JWT token**
```
POST http://localhost:3000/auth/login
Content-Type: application/json

{ "username": "admin", "password": "admin123" }
```
Expected: `{ "token": "eyJhbG..." }` — save this token.

**3. Verify auth guard**
```
GET http://localhost:3000/runs/fake-id
```
No Authorization header. Expected: `401 { "error": "Missing or malformed Authorization header" }`

**4. Upload a zip file**
```
POST http://localhost:3000/submit
Authorization: Bearer <token>
Content-Type: multipart/form-data

  file    → any .zip file
  language → cpp
```
Expected: `202 { "submissionId": "a3f9b2c1-..." }` — save the submissionId.

**5. Check submission status**
```
GET http://localhost:3000/runs/<submissionId>
Authorization: Bearer <token>
```
Expected: `{ "submissionId": "...", "status": "queued", "contestantId": "admin", "language": "cpp" }`

---

## Verifying Infrastructure

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

---

## Stopping Infrastructure

```bash
docker compose -f infra/docker-compose.yml down
```

To also remove all stored data (full reset):
```bash
docker compose -f infra/docker-compose.yml down -v
```
