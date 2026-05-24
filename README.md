# IICPC Platform

**Distributed Benchmarking & Hosting Platform** — IICPC Summer Hackathon 2026.

Contestants upload their trading engine code (C++, Rust, Go). The platform containerises it in a secure sandbox, fires thousands of distributed bots at it, captures latency/throughput/correctness telemetry, and streams live scores to a real-time leaderboard.

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
│   ├── shared/                        # @iicpc/shared — contract layer imported by every service
│   │   └── src/
│   │       ├── types.ts               # Domain interfaces: Submission, TelemetryEvent, LiveScore, Kafka events
│   │       ├── schema.ts              # Drizzle ORM table definitions (submissions + metrics hypertable)
│   │       ├── db.ts                  # createDb(pool) — typed Drizzle client factory
│   │       ├── topics.ts              # Kafka topic constants: SUBMISSION_READY, SUBMISSION_STOPPED
│   │       ├── kafka.ts               # createProducer() / createConsumer() factory helpers
│   │       ├── errors.ts              # Typed errors: SandboxBuildError, ContainerTimeoutError
│   │       ├── config.ts              # getEnv() / getEnvNumber() — fail-fast env helpers
│   │       └── index.ts               # Barrel export — single import for all of the above
│   │
│   ├── gateway/                       # API Gateway — public HTTP entry point (port 3000)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── app.ts                 # Express app: helmet → rate-limit → cors → json → routes
│   │       ├── server.ts              # HTTP listen + MinIO bucket creation on startup
│   │       ├── setup.ts               # ensureInfrastructure() — idempotent bucket creation
│   │       ├── middleware/
│   │       │   └── auth.ts            # requireAuth() — JWT Bearer verification middleware
│   │       └── routes/
│   │           ├── health.ts          # GET  /health — k8s liveness probe
│   │           ├── auth.ts            # POST /auth/login — issue signed JWT (30d expiry)
│   │           ├── submit.ts          # POST /submit — multer-s3 stream to MinIO, trigger sandbox
│   │           └── runs.ts            # GET  /runs/:id — submission status from Redis
│   │
│   └── sandbox/                       # Sandbox Engine — container builder (port 3001, internal only)
│       ├── Dockerfile
│       └── src/
│           ├── server.ts              # Express: POST /sandbox/deploy (fire-and-forget pipeline)
│           ├── pipeline.ts            # Orchestrates all steps + Redis status updates
│           ├── minio-client.ts        # Download artifact from MinIO → /tmp/iicpc/{id}/, auto-extract zip
│           ├── builder.ts             # Detect language, write Dockerfile, docker.buildImage() via socket
│           ├── runner.ts              # createContainer() with full isolation config, get sandbox-net IP
│           ├── health-poller.ts       # Poll GET /health every 2s, 30s timeout → ContainerTimeoutError
│           └── publisher.ts          # Kafka: publish submission.ready / submission.stopped
│
├── infra/
│   ├── docker-compose.yml             # All 6 services: gateway, sandbox, redpanda, timescale, redis, minio
│   ├── docker-compose.override.yml    # Dev overrides (hot-reload mounts)
│   └── drizzle/                       # Drizzle-managed SQL migrations
│       ├── 0000_*.sql                 # CREATE TABLE submissions + metrics (auto-generated)
│       └── 0001_hypertable.sql        # create_hypertable() + indexes (hand-written)
│
├── scripts/
│   ├── migrate.ts                     # Apply all pending Drizzle migrations to TimescaleDB
│   └── wait-for-infra.sh              # Poll Docker health endpoints until all containers ready
│
├── docs/
│   ├── blueprint.md                   # Full system architecture blueprint
│   ├── database-design.md             # Three-store schema reference (TimescaleDB · Redis · MinIO)
│   └── phase-planner.md               # Phase-by-phase engineering roadmap
│
├── drizzle.config.ts                  # Drizzle Kit config (schema → infra/drizzle/)
├── .env.example                       # Environment variable template (copy to .env)
├── tsconfig.base.json                 # Shared TypeScript config extended by every package
├── turbo.json                         # Turborepo pipeline (build @iicpc/shared first)
└── pnpm-workspace.yaml                # Declares packages/*, frontend as workspace packages
```

---

## Build Status

| Phase | Service | Status | Notes |
|---|---|---|---|
| **Phase 0** | `packages/shared` | ✅ Complete | Types, Kafka helpers, Drizzle schema, config |
| **Phase 0** | `infra/` + migrations | ✅ Complete | Docker Compose, TimescaleDB migrations |
| **Phase 1** | `packages/gateway` | ✅ Complete | JWT auth, MinIO upload, Redis status, sandbox trigger |
| **Phase 1** | `packages/sandbox` | ✅ Complete | Build pipeline, dual-NIC isolation, Dockerode API |
| **Phase 2** | `packages/bot-fleet` | 🔜 Next | worker_threads, Poisson timing |
| **Phase 2** | `packages/telemetry` | 🔜 Next | Fastify, HDR histogram |
| **Phase 3** | `packages/leaderboard` | ⬜ Pending | SSE stream, Redis sorted set |
| **Phase 4** | `frontend/` | ⬜ Pending | React, Recharts, live dashboard |
| **Phase 5** | `infra/k8s/` | ⬜ Pending | Kubernetes manifests, HPA |

---

## Network Architecture

The platform uses **two Docker networks** to enforce isolation:

```
┌─────────────────── iicpc-network (bridge) ──────────────────────┐
│  gateway   sandbox   redpanda   timescale   redis   minio        │
└──────────────────────────────────────────────────────────────────┘

┌─────────────── sandbox-net (bridge, internal=true) ─────────────┐
│  sandbox   [submission-{id} containers]                          │
│  NO outbound internet routing — internal flag enforced           │
└──────────────────────────────────────────────────────────────────┘
```

**Dual-NIC design:** The sandbox service attaches to both networks. It reaches Redis/MinIO/Redpanda over `iicpc-network`, and reaches submission containers over `sandbox-net` using the container's internal IP directly (no host-port mapping needed). Bot-fleet workers will use the same `sandbox-net` IP to fire orders at contestant containers.

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

The defaults in `.env.example` work as-is for local development.

### 3. Start all infrastructure containers

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts 4 infrastructure services:

| Container | Image | Port | Purpose |
|---|---|---|---|
| `iicpc-redpanda` | redpandadata/redpanda | `19092` | Kafka-compatible message broker |
| `iicpc-timescale` | timescale/timescaledb-pg15 | `5433` | Time-series metrics store |
| `iicpc-redis` | redis:7.2-alpine | `6379` | Live leaderboard + submission status |
| `iicpc-minio` | minio/minio | `9000/9001` | Object store for uploaded artifacts |

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

Applies all pending migrations from `infra/drizzle/` in order:
- Creates the `submissions` table
- Creates the `metrics` table and converts it to a TimescaleDB hypertable (partitioned by `time`)
- Creates composite indexes for fast per-submission queries

Drizzle tracks applied migrations in `__drizzle_migrations` — safe to re-run.

### 5a. Database commands reference

| Command | What it does |
|---|---|
| `pnpm migrate` | Apply all pending migrations to TimescaleDB |
| `pnpm db:generate` | Generate a new migration file after changing `schema.ts` |
| `pnpm db:studio` | Open Drizzle Studio (visual DB browser) at `localhost:4983` |
| `pnpm db:push` | Push schema directly to DB without a migration file (dev only) |

### 6. Build the shared package

```bash
pnpm build
```

Turborepo builds `@iicpc/shared` first (other packages depend on its compiled output).

---

## Running Services in Development

Each service has a `pnpm dev` script that uses `tsx watch` with the root `.env`:

```bash
# Terminal 1 — Gateway (port 3000)
cd packages/gateway && pnpm dev

# Terminal 2 — Sandbox (port 3001)
cd packages/sandbox && pnpm dev
```

Expected gateway startup output:
```
[gateway] MinIO bucket "submissions" already exists
[gateway] listening on port 3000
```

Expected sandbox startup output:
```
[sandbox] listening on port 3001
```

---

## Environment Variables

All variables live in `.env` at the project root:

| Variable | Dev Default | Description |
|---|---|---|
| `JWT_SECRET` | `supersecretchangeme...` | Signing secret for JWT tokens |
| `ADMIN_USERNAME` | `admin` | Username for `POST /auth/login` |
| `ADMIN_PASSWORD` | `admin` | Password for `POST /auth/login` |
| `PORT` | `3000` | Gateway HTTP listen port |
| `SANDBOX_URL` | `http://localhost:3001` | Internal URL gateway uses to call sandbox |
| `SANDBOX_PORT` | `3001` | Sandbox HTTP listen port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `KAFKA_BROKERS` | `localhost:19092` | Redpanda broker address (comma-separated) |
| `MINIO_ENDPOINT` | `http://localhost:9000` | MinIO endpoint (full URL including port) |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO secret key |
| `TIMESCALE_URL` | `postgres://postgres:postgres@localhost:5433/iicpc` | TimescaleDB connection string |
| `BOT_COUNT` | `10` | Bot workers spawned per submission |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin for gateway |

> **Docker Compose override:** When services run inside Docker, `REDIS_URL`, `MINIO_ENDPOINT`, `KAFKA_BROKERS`, and `SANDBOX_URL` are automatically overridden to use internal Docker DNS names (`redis`, `minio`, `redpanda`, `sandbox`) — no manual change needed.

---

## Gateway API Reference

Base URL: `http://localhost:3000`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness probe — `{ status: 'ok', uptime }` |
| `POST` | `/auth/login` | None | Issue JWT — body: `{ username, password }` |
| `POST` | `/submit` | Bearer JWT | Upload code archive → MinIO → trigger sandbox |
| `GET` | `/runs/:id` | Bearer JWT | Submission status + metadata from Redis |

### Sandbox Internal API

Base URL: `http://localhost:3001` (not exposed to the internet — called by gateway only)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Sandbox liveness probe |
| `POST` | `/sandbox/deploy` | Trigger build pipeline — body: `{ submissionId, artifactPath }` |

### Submission Pipeline — Status Lifecycle

```
queued → building → running    (happy path, ~30–90s depending on build time)
queued → building → error      (compile failure, health timeout, Docker error)
running → stopped              (manual stop via admin API — Phase 3)
```

---

## Postman Test Sequence (Phase 1 Verification)

Run these in order after starting gateway and sandbox:

**1 — Health check**
```
GET http://localhost:3000/health
→ 200: { "status": "ok", "uptime": 4.2 }
```

**2 — Get a JWT token**
```
POST http://localhost:3000/auth/login
Content-Type: application/json
{ "username": "admin", "password": "admin" }
→ 200: { "token": "eyJhbG..." }
```

**3 — Upload a C++ zip file**
```
POST http://localhost:3000/submit
Authorization: Bearer <token>
Content-Type: multipart/form-data
  file     → any .zip containing a .cpp file with a /health endpoint
  language → cpp
→ 202: { "submissionId": "uuid" }
```

**4 — Poll status (repeat every few seconds)**
```
GET http://localhost:3000/runs/<submissionId>
Authorization: Bearer <token>
→ { "status": "building" }   ← during docker build
→ { "status": "running" }    ← container healthy, bots can fire
```

**5 — Verify container is running with isolation**
```bash
docker ps | grep submission-<submissionId>
docker inspect submission-<id> | grep -E "Memory|ReadonlyRootfs|CapDrop|sandbox-net"
```

---

## Verifying Infrastructure Directly

**TimescaleDB:**
```bash
# List all tables
docker exec iicpc-timescale psql -U postgres -d iicpc -c "\dt"

# Confirm metrics is a hypertable
docker exec iicpc-timescale psql -U postgres -d iicpc -c \
  "SELECT hypertable_name FROM timescaledb_information.hypertables;"
```

**Redis:**
```bash
docker exec iicpc-redis redis-cli ping
# → PONG

# Check a submission status
docker exec iicpc-redis redis-cli GET submission:<id>:status
# → "running"
```

**MinIO console:**

Open [http://localhost:9001](http://localhost:9001) → Login: `minioadmin` / `minioadmin123`

Check the `submissions` bucket — uploaded zips appear as `{submissionId}/{filename}.zip`.

**Drizzle Studio:**
```bash
pnpm db:studio
# → Open http://localhost:4983
```

---

## Stopping Infrastructure

```bash
# Stop containers, keep data volumes
docker compose -f infra/docker-compose.yml down

# Stop and wipe all data (full reset)
docker compose -f infra/docker-compose.yml down -v
```
