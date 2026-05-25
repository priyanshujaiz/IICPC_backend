# IICPC Platform

**Distributed Benchmarking & Hosting Platform** — IICPC Summer Hackathon 2026.

Contestants upload their trading engine code (C++, Rust, Go). The platform containerises it in a secure sandbox, fires hundreds of distributed bots at it, captures latency/throughput/correctness telemetry, computes composite scores in real-time, and streams live rankings to a leaderboard via SSE.

---

## Build Status

| Phase | Service | Status | Notes |
|---|---|---|---|
| **Phase 0** | `packages/shared` | ✅ Complete | Types, Kafka helpers, Drizzle schema, config |
| **Phase 0** | `infra/` + migrations | ✅ Complete | Docker Compose (9 services), TimescaleDB migrations |
| **Phase 1** | `packages/gateway` | ✅ Complete | DB-backed JWT auth, MinIO upload, Redis status, sandbox trigger, admin stop |
| **Phase 1** | `packages/sandbox` | ✅ Complete | Build pipeline, dual-NIC isolation, watchdog, max runtime, pre-warm images, container stop+cleanup |
| **Phase 2** | `packages/bot-fleet` | ✅ Complete | 20 workers/submission, Poisson timing, circuit breaker, batch telemetry |
| **Phase 2** | `packages/telemetry` | ✅ Complete | Fastify, HDR histogram, TPS counter, reference engine, 1s flush cycle |
| **Phase 3** | `packages/leaderboard` | ✅ Complete | SSE stream, Redis sorted set, composite scoring, `/stats` + `/scores/snapshot` APIs |
| **Phase 4** | `frontend/` | ✅ Complete | React + Vite, Recharts, live dashboard, leaderboard, submit page, analytics |
| **Phase 5** | `infra/k8s/` | ⬜ Pending | Kubernetes manifests, HPA |

---

## Scoring Formula

```
compositeScore = (40% × latencyScore) + (40% × throughputScore) + (20% × correctnessScore)
```

- **Latency (40%)** — p99 round-trip time. Lower is better. Normalized across all active submissions.
- **Throughput (40%)** — Orders acknowledged per second (TPS). Higher is better.
- **Correctness (20%)** — MARKET order fill accuracy. `(correct fills / total market orders) × 100`.

Scores update every **1 second** and stream to the leaderboard via SSE.

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
│   │       ├── schema.ts               # Drizzle ORM: users + submissions + metrics tables
│   │       ├── db.ts                    # createDb(pool) — typed Drizzle client factory
│   │       ├── topics.ts               # Kafka topic constants
│   │       ├── kafka.ts                # createProducer() / createConsumer() factories
│   │       ├── errors.ts               # SandboxBuildError, ContainerTimeoutError
│   │       ├── config.ts               # getEnv() / getEnvNumber() — fail-fast helpers
│   │       └── index.ts                # Barrel export
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
│   │           └── runs.ts              # GET /runs, GET /runs/:id, DELETE /runs/:id (admin stop)
│   │
│   ├── sandbox/                         # Sandbox Engine — container builder (port 3001, internal)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── server.ts                # POST /sandbox/deploy, POST /sandbox/stop, GET /sandbox/status
│   │       ├── pipeline.ts              # Full build pipeline + watchdog launch
│   │       ├── watchdog.ts              # Container lifecycle: detects exit, enforces MAX_RUNTIME_MS
│   │       ├── minio-client.ts          # Download artifact from MinIO → /tmp/iicpc/{id}/
│   │       ├── builder.ts               # Language detection, multi-stage Dockerfiles, preWarmImages()
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
│   ├── telemetry/                       # Telemetry Ingester — metrics collector (port 4000, internal)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── server.ts                # Fastify: POST /events + POST /events/batch + GET /health
│   │       ├── histogram.ts             # HDR Histogram per submission (O(1) p50/p90/p99)
│   │       ├── tps-counter.ts           # Sliding 1s window TPS counter per submission
│   │       ├── reference-engine.ts      # Per-submission MARKET order fill validator
│   │       ├── scorer.ts                # compositeScore = 0.4×latency + 0.4×throughput + 0.2×correctness
│   │       ├── flush.ts                 # 1s cycle: histogram → scorer → TimescaleDB + Redis leaderboard
│   │       └── routes/
│   │           └── events.ts            # Route handlers for single + batch telemetry events
│   │
│   └── leaderboard/                     # Leaderboard Service — live scores (port 4001)
│       ├── Dockerfile
│       └── src/
│           ├── app.ts                   # Express: helmet → cors → all routes
│           ├── server.ts                # HTTP listen + Redis seed on startup
│           ├── redis.ts                 # Read-only Redis client
│           ├── db.ts                    # pg Pool → TimescaleDB (read-only)
│           └── routes/
│               ├── health.ts            # GET  /health
│               ├── snapshot.ts          # GET  /scores/snapshot — one-shot leaderboard (team names + scores)
│               ├── stream.ts            # GET  /scores/stream — SSE push every 1s
│               ├── metrics.ts           # GET  /metrics/:id — time-series for charts
│               └── stats.ts             # GET  /scores/stats — platform-wide KPIs for dashboard
│
├── frontend/                            # React + Vite SPA (port 5173 dev)
│   ├── vite.config.ts                   # Dev proxy: /api→gateway, /scores→leaderboard, /metrics→leaderboard
│   └── src/
│       ├── context/AuthContext.tsx       # JWT auth provider (login, register, logout)
│       └── pages/
│           ├── LoginPage.tsx            # Split-screen premium login
│           ├── RegisterPage.tsx         # Matching registration page
│           ├── DashboardPage.tsx        # KPI cards (live /stats) + time-series charts
│           ├── LeaderboardPage.tsx      # Real-time SSE table (team names, language badges, sparklines)
│           ├── SubmitPage.tsx           # Language select → file upload → progress tracker → stop button
│           ├── MyAnalyticsPage.tsx      # Per-submission deep-dive charts
│           ├── ComparePage.tsx          # Side-by-side submission comparison
│           └── BotActivityPage.tsx      # Live bot fleet monitoring
│
├── infra/
│   ├── docker-compose.yml               # All 9 services + 2 networks + 2 volumes
│   └── drizzle/                         # Drizzle-managed SQL migrations
│       ├── 0000_*.sql                   # CREATE TABLE submissions + metrics
│       ├── 0001_*.sql                   # create_hypertable() + indexes
│       └── 0002_users.sql               # users table + idx_users_username
│
├── scripts/
│   ├── migrate.ts                       # Apply all pending migrations to TimescaleDB
│   └── wait-for-infra.sh                # Poll Docker health endpoints
│
└── docs/
    ├── exchange-api.md                  # ⭐ Contestant API contract (what your code must implement)
    ├── blueprint.md                     # Full system architecture blueprint
    ├── database-design.md               # Three-store schema (TimescaleDB · Redis · MinIO)
    ├── IIcpc_hackathon.md               # Hackathon requirements and rules
    └── phase-planner.md                 # Phase-by-phase engineering roadmap
```

---

## Network Architecture

```
┌──────────────────────────── iicpc-network (bridge) ────────────────────────────────────┐
│  gateway  sandbox  bot-fleet  telemetry  leaderboard  redpanda  timescale  redis  minio │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────── sandbox-net (bridge, internal=true) ───────────────────────────────┐
│  sandbox (dual-NIC)   bot-fleet (dual-NIC)   [submission-{id} containers]              │
│  NO outbound internet routing — internal flag enforced                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Dual-NIC services:** Both `sandbox` and `bot-fleet` attach to both networks.
- They reach Redis / MinIO / Redpanda / Telemetry over `iicpc-network`
- They reach submission containers over `sandbox-net` using the container's internal IP

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

### 3. Start everything with Docker Compose

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

This starts all 9 services:

| Container | Port | Purpose |
|---|---|---|
| `iicpc-gateway` | `3000` | Public API — auth, submit, runs |
| `iicpc-sandbox` | `3001` | Container builder + stop/status (internal) |
| `iicpc-bot-fleet` | — | Kafka-driven load generator (20 bots/submission) |
| `iicpc-telemetry` | `4000` | Metrics ingester + scorer (internal) |
| `iicpc-leaderboard` | `4001` | SSE stream + /stats + /scores/snapshot |
| `iicpc-redpanda` | `19092` | Kafka-compatible message broker |
| `iicpc-timescale` | `5433` | TimescaleDB — metrics + users + submissions |
| `iicpc-redis` | `6379` | Live leaderboard + submission status |
| `iicpc-minio` | `9000/9001` | Object store for uploaded code archives |

### 4. Run database migrations

```bash
pnpm migrate
```

### 5. Start the frontend (dev mode)

```bash
cd frontend && pnpm dev
```

Open `http://localhost:5173` — register an account and submit code.

---

## Contestant Exchange API

> **Full specification:** [`docs/exchange-api.md`](docs/exchange-api.md)

Your trading engine must expose two HTTP endpoints on port `8080`:

### `GET /health` — Health check
```json
{ "status": "ok" }
```
Must return 200 within 30 seconds of container start.

### `POST /order` — Process an order
Bots send ~300 orders/sec. Three order types:

```
60% LIMIT   — { orderId, type:"LIMIT",  side, price, quantity }
25% MARKET  — { orderId, type:"MARKET", side, quantity }
15% CANCEL  — { orderId, type:"CANCEL", cancelOrderId }
```

Expected response:
```json
{ "orderId": "...", "status": "filled", "filledQty": 17 }
```

### Container Constraints
| Resource | Limit |
|---|---|
| Memory | 512 MB (hard cap, OOM = kill) |
| CPU | 1 vCPU |
| Filesystem | Read-only |
| Network | Isolated (no internet) |
| Max Duration | 10 minutes (auto-stopped) |
| Process Limit | 100 PIDs |

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
| `BOT_COUNT` | `20` | Bot worker threads spawned per submission |
| `BOT_LAMBDA` | `15` | Poisson rate — target orders/sec per bot |
| `TELEMETRY_URL` | `http://localhost:4000` | Telemetry ingester URL (bot-fleet → telemetry) |
| `TELEMETRY_PORT` | `4000` | Telemetry Fastify listen port |
| `LEADERBOARD_PORT` | `4001` | Leaderboard HTTP listen port |
| `MAX_RUNTIME_MS` | `600000` | Max time a submission container runs (10 min) |

> **Docker Compose:** Internal service URLs are automatically overridden via the `environment:` block in `docker-compose.yml`. No manual change needed.

---

## Gateway API Reference

Base URL: `http://localhost:3000`

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness probe |
| `POST` | `/auth/register` | None | Register — `{ username, password }` → `{ token, userId, username, role }` |
| `POST` | `/auth/login` | None | Login — `{ username, password }` → `{ token, userId, username, role }` |

### Submissions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/submit` | Bearer JWT | Upload code archive (multipart) → triggers sandbox build |
| `GET` | `/runs/:id` | Bearer JWT | Real-time status from Redis |
| `GET` | `/runs` | Bearer JWT | All submissions for current user (PostgreSQL) |
| `DELETE` | `/runs/:id` | Bearer JWT | **Stop submission** — kills container, drains bots, cleans up |

### Leaderboard API (port 4001)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/scores/snapshot` | One-shot leaderboard (team names, scores, language, status) |
| `GET` | `/scores/stream` | SSE stream — pushes updated leaderboard every 1s |
| `GET` | `/scores/stats` | Platform-wide KPIs (activeSubmissions, totalBots, platformTps, avgCorrectness) |
| `GET` | `/metrics/:id` | Time-series data for a specific submission |

### Sandbox Internal API (port 3001)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Sandbox liveness probe |
| `POST` | `/sandbox/deploy` | Trigger build pipeline — `{ submissionId, artifactPath }` |
| `POST` | `/sandbox/stop` | Stop + remove container + image — `{ submissionId }` |
| `GET` | `/sandbox/status` | List all running submission containers |

---

## Submission Pipeline — Full Lifecycle

```
POST /submit
  ↓ multer-s3 streams file to MinIO
  ↓ Redis: submission:{id}:status = "queued", meta hash set
  ↓ PostgreSQL: submissions row inserted
  ↓ POST /sandbox/deploy (fire-and-forget)

Sandbox pipeline (async):
  queued → building → (detect language) → (multi-stage docker build) → (docker run) → (health poll) → running
  any failure → error + submission.stopped published to Kafka

On status = "running":
  ↓ Kafka: submission.ready { submissionId, host, port }
  ↓ Watchdog starts (background) — enforces MAX_RUNTIME_MS (10 min)

Bot Fleet (Kafka consumer):
  ↓ Spawns 20 worker threads per submission
  ↓ Each worker fires Poisson-timed orders (~15/sec each = ~300 TPS total)
  ↓ Batches 50 telemetry events → POST /events/batch to telemetry

Telemetry Ingester (1s flush cycle):
  ↓ HDR Histogram per submission → p50/p90/p99
  ↓ TPS counter (1s sliding window)
  ↓ Reference engine validates MARKET order fills → correctness rate
  ↓ Scorer normalizes across all active submissions → compositeScore
  ↓ TimescaleDB INSERT metrics row
  ↓ Redis ZADD leaderboard + SET score JSON

Leaderboard (SSE):
  ↓ Every 1s: ZREVRANGEBYSCORE → enriches with team name + language + status
  ↓ Pushes to all connected frontend clients via Server-Sent Events

Stopping (user-initiated or auto-timeout):
  ↓ DELETE /runs/:id → Redis fleet:stop key → POST /sandbox/stop
  ↓ Container stopped + removed + image deleted (disk freed)
  ↓ Kafka submission.stopped → bot-fleet terminates all workers
  ↓ Final score preserved in leaderboard
```

**Status lifecycle:**
```
queued → building → running → stopped   (normal — timeout or user stop)
queued → building → error               (build failure, health timeout, OOM)
```

---

## Database Schema

### PostgreSQL (TimescaleDB)

**`users`** — contestant registration
| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `username` | TEXT UNIQUE | Contestant handle |
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
| `submitted_at` | TIMESTAMPTZ | Upload timestamp |
| `stopped_at` | TIMESTAMPTZ | When stopped (null if still running) |

**`metrics`** *(hypertable)* — 1 row per second per running submission
| Column | Type | Description |
|---|---|---|
| `time` | TIMESTAMPTZ | Hypertable partition key |
| `submission_id` | TEXT | Soft FK → `submissions.id` |
| `latency_p50/p90/p99` | FLOAT | HDR histogram percentiles (ms) |
| `tps` | FLOAT | Orders per second |
| `correctness_rate` | FLOAT | Fill accuracy 0–100 |
| `composite_score` | FLOAT | Weighted composite (0–100) |
| `total_orders` | INT | Orders processed in this window |
| `correct_fills` | INT | Correct MARKET fills |
| `total_fills` | INT | Total MARKET orders attempted |

### Redis Key Patterns

| Key | Type | Contents |
|---|---|---|
| `submission:{id}:status` | String | `queued / building / running / stopped / error` |
| `submission:{id}:meta` | Hash | `contestantId, username, artifactPath, language, submittedAt, containerId` |
| `submission:{id}:score` | String (JSON) | `{ p50, p90, p99, tps, correctnessRate, compositeScore }` |
| `leaderboard` | Sorted Set | member=submissionId, score=compositeScore |
| `fleet:stop:{id}` | String | `"1"` — signals bots to drain (30s TTL) |

---

## Verification Commands

**Full stack health check:**
```bash
docker compose -f infra/docker-compose.yml ps

# All 9 services should show "Up" or "Up (healthy)"
docker exec iicpc-redis redis-cli ping                     # → PONG
docker exec iicpc-timescale psql -U postgres -d iicpc -c "\dt"
curl http://localhost:3000/health                           # gateway
curl http://localhost:4001/health                           # leaderboard
curl http://localhost:4001/scores/stats                     # platform KPIs
```

**Test the full flow:**
```bash
# 1. Register
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"team-alpha","password":"test123"}' | jq .

# 2. Submit (replace TOKEN)
curl -s -X POST http://localhost:3000/submit \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@my-exchange.zip" \
  -F "language=cpp" | jq .

# 3. Poll status
curl -s http://localhost:3000/runs/SUBMISSION_ID \
  -H "Authorization: Bearer TOKEN" | jq .

# 4. Watch leaderboard
curl -N http://localhost:4001/scores/stream

# 5. Stop a submission
curl -s -X DELETE http://localhost:3000/runs/SUBMISSION_ID \
  -H "Authorization: Bearer TOKEN" | jq .
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
