# IICPC Platform

**Distributed Benchmarking & Hosting Platform** — IICPC Summer Hackathon 2026.

Contestants upload their trading engine code (C++, Rust, Go). The platform containerises it in a secure sandbox, fires thousands of distributed bots at it, captures latency/throughput/correctness telemetry, and streams live scores to a real-time leaderboard.

---

## Build Status

| Phase | Service | Status | Notes |
|---|---|---|---|
| **Phase 0** | `packages/shared` | ✅ Complete | Types, Kafka helpers, Drizzle schema, config |
| **Phase 0** | `infra/` + migrations | ✅ Complete | Docker Compose, TimescaleDB migrations |
| **Phase 1** | `packages/gateway` | ✅ Complete | DB-backed JWT auth, MinIO upload, Redis status, sandbox trigger |
| **Phase 1** | `packages/sandbox` | ✅ Complete | Build pipeline, dual-NIC isolation, container watchdog, max runtime |
| **Phase 2** | `packages/bot-fleet` | ✅ Complete | worker_threads, Poisson timing, circuit breaker, batch telemetry |
| **Phase 2** | `packages/telemetry` | ✅ Complete | Fastify, HDR histogram, TPS counter, 1s flush cycle |
| **Phase 3** | `packages/leaderboard` | 🔜 Next | SSE stream, Redis sorted set, composite score |
| **Phase 4** | `frontend/` | ⬜ Pending | React, Recharts, live dashboard |
| **Phase 5** | `infra/k8s/` | ⬜ Pending | Kubernetes manifests, HPA |

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | v20+ | Runtime for all services |
| [pnpm](https://pnpm.io/installation) | v10+ | Monorepo package manager |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest | Infrastructure + sandbox containers |

---

## Project Structure

```
iicpc-platform/
├── packages/
│   ├── shared/                          # @iicpc/shared — contract layer
│   │   └── src/
│   │       ├── types.ts                 # Domain interfaces: Submission, TelemetryEvent, LiveScore
│   │       ├── schema.ts                # Drizzle ORM: users + submissions + metrics tables
│   │       ├── db.ts                    # createDb(pool) — typed Drizzle client factory
│   │       ├── topics.ts                # Kafka topic constants
│   │       ├── kafka.ts                 # createProducer() / createConsumer() factories
│   │       ├── errors.ts                # SandboxBuildError, ContainerTimeoutError
│   │       ├── config.ts                # getEnv() / getEnvNumber() — fail-fast helpers
│   │       └── index.ts                 # Barrel export
│   │
│   ├── gateway/                         # API Gateway — public HTTP entry point (port 3000)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── app.ts                   # Express: helmet → rate-limit → cors → json → routes
│   │       ├── server.ts                # HTTP listen + MinIO bucket creation on startup
│   │       ├── setup.ts                 # ensureInfrastructure() — idempotent bucket creation
│   │       ├── db.ts                    # Drizzle client (pg pool → TimescaleDB)
│   │       ├── middleware/
│   │       │   └── auth.ts              # requireAuth() + requireAdmin() — JWT middleware
│   │       └── routes/
│   │           ├── health.ts            # GET  /health
│   │           ├── auth.ts              # POST /auth/register + POST /auth/login (DB-backed)
│   │           ├── submit.ts            # POST /submit — MinIO upload + Redis + PostgreSQL + sandbox
│   │           └── runs.ts              # GET  /runs/:id (Redis) + GET /runs (PostgreSQL history)
│   │
│   ├── sandbox/                         # Sandbox Engine — container builder (port 3001, internal)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── server.ts                # Express: POST /sandbox/deploy + POST /sandbox/stop/:id
│   │       ├── pipeline.ts              # Full build pipeline + watchdog launch
│   │       ├── watchdog.ts              # Container lifecycle: detects exit, enforces MAX_RUNTIME_MS
│   │       ├── minio-client.ts          # Download artifact from MinIO → /tmp/iicpc/{id}/
│   │       ├── builder.ts               # Detect language, build Docker image via Dockerode
│   │       ├── runner.ts                # createContainer() with full isolation, get sandbox-net IP
│   │       ├── health-poller.ts         # Poll GET /health every 2s, 30s timeout
│   │       └── publisher.ts             # Kafka: publish submission.ready / submission.stopped
│   │
│   ├── bot-fleet/                       # Bot Fleet — distributed load generator (no public port)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── orchestrator.ts          # Kafka consumer + worker pool (Map<submissionId, Worker[]>)
│   │       ├── bot-worker.ts            # worker_thread: Poisson loop + circuit breaker + batch telemetry
│   │       └── scenario.ts              # Order generation: 60% LIMIT / 25% MARKET / 15% CANCEL
│   │
│   └── telemetry/                       # Telemetry Ingester — metrics collector (port 4000, internal)
│       ├── Dockerfile
│       └── src/
│           ├── server.ts                # Fastify: POST /events + POST /events/batch + GET /health
│           ├── histogram.ts             # HDR Histogram per submission (O(1) p50/p90/p99)
│           ├── tps-counter.ts           # Sliding 1s window TPS counter per submission
│           ├── flush.ts                 # setInterval(1000ms): log percentiles to console (Phase 3: DB write)
│           └── routes/
│               └── events.ts            # Route handlers for single + batch telemetry events
│
├── infra/
│   ├── docker-compose.yml               # All 8 services: gateway, sandbox, bot-fleet, telemetry,
│   │                                    #   redpanda, timescale, redis, minio
│   ├── docker-compose.override.yml      # Dev overrides (hot-reload mounts)
│   └── drizzle/                         # Drizzle-managed SQL migrations
│       ├── 0000_*.sql                   # CREATE TABLE submissions + metrics
│       ├── 0001_*.sql                   # create_hypertable() + indexes + users table (generated)
│       └── 0002_users.sql               # users table + idx_users_username
│
├── scripts/
│   ├── migrate.ts                       # Apply all pending migrations to TimescaleDB
│   └── wait-for-infra.sh                # Poll Docker health endpoints
│
└── docs/
    ├── blueprint.md                     # Full system architecture blueprint
    ├── database-design.md               # Three-store schema (TimescaleDB · Redis · MinIO)
    └── phase-planner.md                 # Phase-by-phase engineering roadmap
```

---

## Network Architecture

The platform uses **two Docker networks** to enforce isolation:

```
┌──────────────────────────── iicpc-network (bridge) ────────────────────────────────────┐
│  gateway   sandbox   bot-fleet   telemetry   redpanda   timescale   redis   minio       │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────── sandbox-net (bridge, internal=true) ───────────────────────────────┐
│  sandbox (dual-NIC)   bot-fleet (dual-NIC)   [submission-{id} containers]              │
│  NO outbound internet routing — internal flag enforced                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Dual-NIC services:** Both `sandbox` and `bot-fleet` attach to both networks.
- They reach Redis / MinIO / Redpanda / Telemetry over `iicpc-network`
- They reach submission containers over `sandbox-net` using the container's internal IP directly

---

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Defaults in `.env.example` work as-is for local development.

### 3. Start all infrastructure containers

```bash
docker compose -f infra/docker-compose.yml up -d
```

| Container | Image | Port | Purpose |
|---|---|---|---|
| `iicpc-redpanda` | redpandadata/redpanda | `19092` | Kafka-compatible message broker |
| `iicpc-timescale` | timescale/timescaledb-pg15 | `5433` | Time-series metrics + user/submission store |
| `iicpc-redis` | redis:7.2-alpine | `6379` | Live leaderboard + submission status |
| `iicpc-minio` | minio/minio | `9000/9001` | Object store for uploaded artifacts |

### 4. Run database migrations

```bash
pnpm migrate
```

Creates all three tables: `submissions`, `metrics` (hypertable), `users`.

```bash
# Verify
docker exec iicpc-timescale psql -U postgres -d iicpc -c "\dt"
#  Schema |    Name     | Type  |  Owner
# --------+-------------+-------+----------
#  public | metrics     | table | postgres
#  public | submissions | table | postgres
#  public | users       | table | postgres
```

### 5. Build the shared package

```bash
pnpm build
```

### 6. Run services in development

```bash
# Terminal 1 — Gateway (port 3000)
cd packages/gateway && pnpm dev

# Terminal 2 — Sandbox (port 3001, internal)
cd packages/sandbox && pnpm dev

# Terminal 3 — Telemetry (port 4000, internal)
cd packages/telemetry && pnpm dev

# Terminal 4 — Bot Fleet (no port, Kafka-driven)
cd packages/bot-fleet && pnpm dev
```

---

## Environment Variables

| Variable | Dev Default | Description |
|---|---|---|
| `JWT_SECRET` | `supersecretchangeme...` | Signing secret for JWT tokens |
| `PORT` | `3000` | Gateway HTTP listen port |
| `SANDBOX_URL` | `http://localhost:3001` | Internal URL gateway uses to call sandbox |
| `SANDBOX_PORT` | `3001` | Sandbox HTTP listen port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `KAFKA_BROKERS` | `localhost:19092` | Redpanda broker address |
| `MINIO_ENDPOINT` | `http://localhost:9000` | MinIO endpoint |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO secret key |
| `TIMESCALE_URL` | `postgres://postgres:postgres@localhost:5433/iicpc` | TimescaleDB connection |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin |
| `BOT_COUNT` | `5` | Bot worker threads spawned per submission |
| `BOT_LAMBDA` | `10` | Poisson rate — target orders/sec per bot |
| `TELEMETRY_URL` | `http://localhost:4000` | Telemetry ingester URL (bot-fleet → telemetry) |
| `TELEMETRY_PORT` | `4000` | Telemetry Fastify listen port |
| `MAX_RUNTIME_MS` | `600000` | Max time a submission container runs (10 min default) |

> **Docker Compose:** Internal service URLs are automatically overridden via the `environment:` block in `docker-compose.yml`. No manual change needed.

---

## Gateway API Reference

Base URL: `http://localhost:3000`

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness probe — `{ status: 'ok', uptime }` |
| `POST` | `/auth/register` | None | Register a contestant — `{ username, password }` → `{ token, userId, username, role }` |
| `POST` | `/auth/login` | None | Login — `{ username, password }` → `{ token, userId, username, role }` |

### Submissions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/submit` | Bearer JWT | Upload code archive → MinIO + Redis + PostgreSQL + trigger sandbox |
| `GET` | `/runs/:id` | Bearer JWT | Real-time submission status from Redis |
| `GET` | `/runs` | Bearer JWT | All submissions for the authenticated user (PostgreSQL) |

### Sandbox Internal API

Base URL: `http://localhost:3001` — not exposed externally, called by gateway only.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Sandbox liveness probe |
| `POST` | `/sandbox/deploy` | Trigger build pipeline — `{ submissionId, artifactPath }` |
| `POST` | `/sandbox/stop/:id` | Stop a running container (watchdog handles cleanup) |

### Telemetry Internal API

Base URL: `http://localhost:4000` — called by bot workers only.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Telemetry liveness probe |
| `POST` | `/events` | Single telemetry event |
| `POST` | `/events/batch` | Batch of 50 telemetry events (preferred) |

---

## Submission Pipeline — Full Lifecycle

```
POST /submit
  ↓ multer-s3 streams file to MinIO
  ↓ Redis: submission:{id}:status = "queued"
  ↓ PostgreSQL: submissions row inserted
  ↓ POST /sandbox/deploy (fire-and-forget)

Sandbox pipeline (async):
  queued → building → (docker build) → (docker run) → (health poll) → running
  any failure → error + submission.stopped published to Kafka

On status = "running":
  ↓ Kafka: submission.ready { submissionId, host, port }
  ↓ Watchdog starts (background) — enforces MAX_RUNTIME_MS

Bot Fleet (Kafka consumer):
  ↓ Spawns BOT_COUNT worker threads per submission
  ↓ Each worker fires Poisson-timed orders at container IP on sandbox-net
  ↓ Batches 50 telemetry events → POST /events/batch to telemetry

Telemetry Ingester:
  ↓ HDR Histogram per submission (p50/p90/p99)
  ↓ TPS counter (1s sliding window)
  ↓ Flush every 1s → console log (Phase 3: TimescaleDB + Redis leaderboard)

Watchdog:
  ↓ container.wait() resolves on container exit (crash, OOM, or MAX_RUNTIME_MS)
  ↓ Redis: status = "stopped"
  ↓ Kafka: submission.stopped → bot fleet terminates workers
  ↓ Container removed from Docker
```

**Status lifecycle:**
```
queued → building → running → stopped   (normal — ran for MAX_RUNTIME_MS)
queued → building → error              (build failure, health timeout)
```

---

## Database Schema

### PostgreSQL (TimescaleDB)

**`users`** — contestant registration
| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `username` | TEXT UNIQUE | Team/contestant handle |
| `password_hash` | TEXT | bcrypt hash (10 rounds) |
| `role` | TEXT | `'admin'` or `'contestant'` |
| `created_at` | TIMESTAMPTZ | Registration timestamp |

**`submissions`** — one row per upload
| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `contestant_id` | TEXT | Soft FK → `users.id` |
| `language` | TEXT | `'cpp'`, `'rust'`, or `'go'` |
| `artifact_path` | TEXT | MinIO key: `{submissionId}/{filename}` |
| `status` | TEXT | `queued / building / running / stopped / error` |
| `container_host` | TEXT | sandbox-net IP (set by sandbox) |
| `container_port` | INT | Container port (set by sandbox) |
| `submitted_at` | TIMESTAMPTZ | — |

**`metrics`** *(hypertable)* — 1 row per second per running submission
| Column | Type | Description |
|---|---|---|
| `time` | TIMESTAMPTZ | Hypertable partition key |
| `submission_id` | TEXT | Soft FK → `submissions.id` |
| `latency_p50/90/99` | FLOAT | HDR histogram percentiles (ms) |
| `tps` | FLOAT | Orders per second |
| `correctness_rate` | FLOAT | Fill accuracy 0–100 |
| `composite_score` | FLOAT | Weighted score (Phase 3) |

### Redis Key Patterns

| Key | Type | Contents |
|---|---|---|
| `submission:{id}:status` | String | `queued / building / running / stopped / error` |
| `submission:{id}:meta` | Hash | `contestantId, username, artifactPath, language, submittedAt` |
| `leaderboard` | Sorted Set | member=submissionId, score=compositeScore (Phase 3) |

---

## Verification Commands

**Full stack health check:**
```bash
# All infra containers healthy
docker compose -f infra/docker-compose.yml ps

# Redis
docker exec iicpc-redis redis-cli ping          # → PONG

# TimescaleDB tables
docker exec iicpc-timescale psql -U postgres -d iicpc -c "\dt"

# MinIO console
# Open http://localhost:9001  →  minioadmin / minioadmin123
```

**Test the auth + submit flow:**
```bash
# 1. Register
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"team-alpha","password":"test123"}' | jq .

# 2. Login
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"team-alpha","password":"test123"}' | jq .token

# 3. Submit (replace TOKEN)
curl -s -X POST http://localhost:3000/submit \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@my-exchange.zip" \
  -F "language=cpp" | jq .

# 4. Poll status
curl -s http://localhost:3000/runs/SUBMISSION_ID \
  -H "Authorization: Bearer TOKEN" | jq .

# 5. User's submission history
curl -s http://localhost:3000/runs \
  -H "Authorization: Bearer TOKEN" | jq .
```

**Watch telemetry output (when bots are firing):**
```bash
# Should print every ~1s when a submission is running:
# [telemetry] abc12345  p50=2ms  p90=8ms  p99=23ms  TPS=847
cd packages/telemetry && pnpm dev
```

---

## Stopping Infrastructure

```bash
# Stop containers, keep data volumes
docker compose -f infra/docker-compose.yml down

# Stop and wipe all data (full reset)
docker compose -f infra/docker-compose.yml down -v
```

---

## Database Commands

| Command | What it does |
|---|---|
| `pnpm migrate` | Apply all pending migrations to TimescaleDB |
| `pnpm db:generate` | Generate a new migration after changing `schema.ts` |
| `pnpm db:studio` | Open Drizzle Studio at `localhost:4983` |
| `pnpm db:push` | Push schema directly (dev only, skips migration file) |
