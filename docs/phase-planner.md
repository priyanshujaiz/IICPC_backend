# IICPC Summer Hackathon 2026
## Engineering Execution Roadmap & Phase Planner
### Distributed Benchmarking & Hosting Platform

> **Hackathon Window:** May 9 – June 10, 2026 (4.5 weeks)
> **Team Size:** Up to 3 engineers
> **Submission Opens:** Final week (June 7–10)
> **Stack:** TypeScript · Node.js · React · Redpanda · TimescaleDB · Redis · MinIO · Docker/k8s

---

## Table of Contents

1. [Requirements Coverage Matrix](#1-requirements-coverage-matrix)
2. [High-Level System Flow](#2-high-level-system-flow)
3. [Architecture Improvement Opportunities](#3-architecture-improvement-opportunities)
4. [MVP-First Strategy](#4-mvp-first-strategy)
5. [Team Ownership Model (3-Person Team)](#5-team-ownership-model)
6. [Phase 0 — Project Bootstrap & Contracts](#phase-0)
7. [Phase 1 — Foundation & Sandbox Pipeline](#phase-1)
8. [Phase 2 — Bot Fleet & Raw Telemetry](#phase-2)
9. [Phase 3 — Persistence, Scoring & Live Leaderboard](#phase-3)
10. [Phase 4 — React Dashboard & Full Integration](#phase-4)
11. [Phase 5 — Hardening, IaC & Submission Polish](#phase-5)
12. [Demo Day Checklist](#12-demo-day-checklist)
13. [Simplification Guide (If Time Runs Short)](#13-simplification-guide)
14. [Production-Grade Improvements (If Extra Time Remains)](#14-production-grade-improvements)
15. [Overall Risk Register](#15-overall-risk-register)

---

## 1. Requirements Coverage Matrix

Every IICPC mandate is mapped to our architecture. This matrix is the north star — if a feature is not on this list, it is scope creep.

| IICPC Requirement | Our Implementation | Service | Phase |
|---|---|---|---|
| Secure code upload pipeline | JWT auth + rate limiting + multer-s3 streaming to MinIO (zero disk write) | `gateway` | 1 |
| Containerize submissions in isolated environments | Dockerode: CapDrop ALL, ReadonlyRootfs, isolated network, PidsLimit | `sandbox` | 1 |
| Strict CPU and memory limits | HostConfig: Memory 512MB, CpusetCpus, NanoCpus 1 core | `sandbox` | 1 |
| Scalable bot fleet (thousands of bots) | worker_threads pool + Poisson arrival timing + k8s HPA scaling | `bot-fleet` | 2 |
| Simulate diverse market participants | 60% Limit / 25% Market / 15% Cancel, randomized price levels | `bot-fleet` | 2 |
| FIX / REST / WebSocket order submission | HTTP REST + WebSocket dual support in bot worker | `bot-fleet` | 2 |
| p50/p90/p99 latency measurement | HDR Histogram per submission, flushed every 1s | `telemetry` | 2–3 |
| Maximum TPS before failure | Event counter per second window, recorded in TimescaleDB | `telemetry` | 3 |
| Price-time priority correctness validation | In-process reference matching engine, replays every MARKET order | `telemetry` | 3 |
| Real-time leaderboard with live metrics | SSE stream from Redis sorted set every 1s | `leaderboard` + `frontend` | 3–4 |
| Dynamic ranking by speed/stability/accuracy | Composite score: 40% latency + 40% TPS + 20% correctness | `leaderboard` | 3 |
| Architecture Blueprint document | This file + blueprint.md + inline API docs | Deliverable | 5 |
| Infrastructure as Code | Docker Compose (demo) + Kubernetes manifests + Helm chart | `infra/` | 5 |
| Horizontal scalability proof | bot-fleet HPA, telemetry replica scaling, stateless gateway | `k8s/` | 5 |

---

## 2. High-Level System Flow

```
Contestant Browser
       │
       ▼
┌─────────────────┐   JWT + multer-s3   ┌──────────────┐
│   API Gateway   │ ──────────────────► │    MinIO     │
│  (port 3000)    │                     │ (artifacts)  │
└────────┬────────┘                     └──────────────┘
         │ POST /sandbox/deploy
         ▼
┌─────────────────┐  Dockerode build    ┌──────────────┐
│  Sandbox Engine │ ──────────────────► │  Contestant  │
│  (packages/     │  + isolation flags  │  Container   │
│   sandbox)      │                     │  (port 8080) │
└────────┬────────┘                     └──────┬───────┘
         │ Kafka: submission-ready              │
         ▼                                      │
┌─────────────────┐  worker_threads    ┌────────┴───────┐
│  Bot Fleet      │ ──────────────────►│  Bot Workers   │
│  Orchestrator   │  Poisson timing    │  (N threads)   │
└─────────────────┘                    └────────┬───────┘
                                                │ POST /events
                                                ▼
                                    ┌───────────────────────┐
                                    │   Telemetry Ingester  │
                                    │   (Fastify port 4000) │
                                    │   HDR Histogram       │
                                    │   Reference Engine    │
                                    └──────┬────────────────┘
                                           │ dual-write (every 1s)
                             ┌─────────────┴─────────────┐
                             ▼                           ▼
                    ┌─────────────────┐       ┌──────────────────┐
                    │  TimescaleDB    │       │  Redis Sorted Set │
                    │  (hypertable)   │       │  (leaderboard)   │
                    └─────────────────┘       └────────┬─────────┘
                                                       │ ZRANGEBYSCORE
                                                       ▼
                                            ┌──────────────────────┐
                                            │  Leaderboard Service │
                                            │  (SSE port 4001)     │
                                            └──────────┬───────────┘
                                                       │ text/event-stream
                                                       ▼
                                            ┌──────────────────────┐
                                            │  React Dashboard     │
                                            │  (Vite + Recharts)   │
                                            └──────────────────────┘
```

**Critical Path (must never be broken):**
`Upload → MinIO → Sandbox Build → Container Health → Kafka → Bot Fleet → Telemetry → Redis → SSE → Frontend`

---

## 3. Architecture Improvement Opportunities

Beyond what's in the blueprint, here are enhancements worth considering during each phase:

| # | Improvement | Impact | Adds Complexity | Suggested Phase |
|---|---|---|---|---|
| A | **Circuit breaker** around bot → exchange calls (prevent cascade when exchange crashes) | High | Low | 2 |
| B | **WebSocket upgrade path** in bot worker (`ws` library alongside HTTP) | High | Medium | 2 |
| C | **Batch telemetry writes** — bots buffer 50 events, POST as array instead of 1-by-1 | High perf | Low | 2 |
| D | **Telemetry async Kafka path** — bots publish to `telemetry-events` topic; ingester consumes (decouples bot from ingester latency) | High | Medium | 3 |
| E | **Admin panel** — stop/start bot run, adjust bot count slider live | Demo polish | Low | 4 |
| F | **Container auto-cleanup** — GC stopped containers after 15 min to prevent disk/memory bleed | Resilience | Low | 5 |
| G | **Prometheus + Grafana** export from telemetry service for judges | Bonus cred | Medium | 5 |
| H | **Reference exchange** hardened as a contestant scaffold (C++ stub + Rust stub) | UX | Low | 2 |
| I | **Submission queue** (Redis list as queue) so multiple submissions don't overwhelm sandbox | Correctness | Low | 3 |
| J | **Rate-limit telemetry ingester** per submissionId to prevent a single runaway bot from DoS-ing the ingester | Safety | Low | 3 |

---

## 4. MVP-First Strategy

### What constitutes the MVP (minimum demo-able product)

```
MVP = Phase 1 complete + Phase 2 core + Phase 3 core + minimal frontend
```

Specifically, the MVP requires:
1. A file can be uploaded and containerized (Phase 1)
2. Bots fire at the container and latency numbers print to console (Phase 2)
3. SSE endpoint returns live scores (Phase 3)
4. A single page that shows a live updating leaderboard table (Phase 4 partial)

**MVP does NOT require:** polished charts, submission detail page, admin panel, k8s manifests, Helm chart, correctness validation (can stub as 100%), or production hardening.

### Decision Checkpoints

| Date | Check | If Behind |
|---|---|---|
| May 16 | Phase 1 done? Container starts from upload? | Simplify: skip MinIO, write to /tmp locally |
| May 23 | Bots firing, telemetry in console? | Simplify: use HTTP-only bots, skip WebSocket |
| May 30 | SSE returning live data? | Simplify: polling every 3s instead of SSE |
| June 6 | Full frontend working? | Cut: submission detail page, focus only on leaderboard page |
| June 9 | k8s + Blueprint complete? | Cut: k8s, deliver Docker Compose only with written k8s explanation |

---

## 5. Team Ownership Model

Recommended ownership split for a 3-person team (adjust to actual skills):

| Engineer | Primary Ownership | Secondary Support |
|---|---|---|
| **Engineer A** (Backend/Infra) | `sandbox`, `gateway`, `infra/`, Docker Compose, k8s manifests | `shared` types |
| **Engineer B** (Systems/Perf) | `bot-fleet`, `telemetry`, reference engine, HDR histogram | `leaderboard` SSE |
| **Engineer C** (Full-Stack/Data) | `frontend`, `leaderboard`, TimescaleDB schema, scoring formula | `gateway` auth |

**Shared ownership (requires sync):**
- `packages/shared/src/types.ts` — all three must agree before changing
- Kafka topic schemas — coordinate between A (sandbox produces) and B (bot-fleet consumes)
- Docker Compose file — any service change must be reflected here

**Daily sync cadence:** 15-minute standup. Share blockers. Merge `main` daily — never let a branch go stale more than 24 hours.

---

## Phase 0

### Project Bootstrap & Contracts
**Timeline:** Day 1 (May 9, first few hours)
**Owner:** All three engineers together

---

### Objective
Establish the monorepo, shared contracts, and running infrastructure so that all three engineers can work in parallel from Day 2 onwards without merge conflicts.

### Why Phase 0 Exists
If types aren't locked and infra isn't running, engineers block each other. 4 hours of joint setup saves days of integration pain.

---

### Engineering Tasks

#### 0.1 — Monorepo Initialization
- [ ] `pnpm init` + `pnpm-workspace.yaml` declaring `packages/*` and `frontend`
- [ ] `turbo.json` with pipeline: `build` depends on `^build`, `dev` runs all in parallel
- [ ] Root `tsconfig.base.json` with `strict: true`, `moduleResolution: bundler`, `paths` for `@iicpc/*`
- [ ] Each package gets its own `tsconfig.json` extending base
- [ ] Root `eslint.config.js` + `.prettierrc` shared across all packages
- [ ] `.gitignore`: `node_modules/`, `dist/`, `.env`, `*.log`
- [ ] `README.md` with one-line run instruction

#### 0.2 — Shared Types Package (`packages/shared`)
- [ ] `src/types.ts`: `Submission`, `TelemetryEvent`, `LiveScore`, `SubmissionReadyEvent`, `SubmissionStoppedEvent`
- [ ] `src/topics.ts`: `TOPICS = { SUBMISSION_READY, SUBMISSION_STOPPED, TELEMETRY_EVENTS }` as constants
- [ ] `src/kafka.ts`: factory helpers `createProducer(brokers)`, `createConsumer(brokers, groupId)`
- [ ] `src/errors.ts`: typed error classes `SandboxBuildError`, `ContainerTimeoutError`, `TelemetryValidationError`
- [ ] `package.json`: name `@iicpc/shared`, build with `tsc`, export `./dist`
- [ ] All other packages add `"@iicpc/shared": "workspace:*"` to their deps

#### 0.3 — Infrastructure Containers (Docker Compose)
- [ ] Write `infra/docker-compose.yml` with all stateful services:
  - Redpanda (single-node, `--smp 1 --memory 1G --overprovisioned`)
  - TimescaleDB (`timescale/timescaledb:latest-pg15`, env `POSTGRES_PASSWORD`)
  - Redis (`redis:7-alpine`)
  - MinIO (`minio/minio`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, health check)
- [ ] Write `infra/docker-compose.override.yml` for hot-reload dev mounts
- [ ] Write `scripts/wait-for-infra.sh` — polls until all health endpoints return 200
- [ ] Run `docker compose up -d` and verify all 4 containers healthy

#### 0.4 — Environment & Secrets
- [ ] `.env.example` with all variables: `JWT_SECRET`, `REDIS_URL`, `KAFKA_BROKERS`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `TIMESCALE_URL`, `BOT_COUNT`
- [ ] Each engineer copies `.env.example` to `.env` locally (never committed)
- [ ] `packages/shared/src/config.ts`: `getEnv(key: string): string` helper with fail-fast on missing vars

#### 0.5 — TimescaleDB Migration
- [ ] Write `infra/migrations/001_init.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS metrics (
    time             TIMESTAMPTZ NOT NULL,
    submission_id    TEXT NOT NULL,
    latency_p50      FLOAT,
    latency_p90      FLOAT,
    latency_p99      FLOAT,
    tps              FLOAT,
    correctness_rate FLOAT,
    composite_score  FLOAT
  );
  SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE);
  CREATE INDEX IF NOT EXISTS idx_metrics_submission ON metrics (submission_id, time DESC);
  ```
- [ ] Write `scripts/migrate.ts`: connects to TimescaleDB via `pg`, runs migration file
- [ ] Add `"migrate": "tsx scripts/migrate.ts"` to root `package.json`

---

### Deliverables
- [ ] `pnpm install` works from root with zero errors
- [ ] `pnpm turbo build` compiles `@iicpc/shared` cleanly
- [ ] `docker compose up -d` starts all 4 infrastructure containers
- [ ] `pnpm migrate` creates the metrics hypertable
- [ ] `.env.example` committed; `.env` in `.gitignore`

### Tests / Validation
- Run `docker compose ps` — all services show `healthy`
- Run `redis-cli ping` → `PONG`
- Run `psql $TIMESCALE_URL -c "\d metrics"` — table exists with all columns
- Import `@iicpc/shared` in a throwaway script, verify types compile

### Parallelization
- Everyone runs `pnpm install` + Docker pull simultaneously
- Engineer A sets up `.env` + Docker Compose while B writes `shared/types.ts` and C writes `shared/topics.ts`

### Risks
| Risk | Mitigation |
|---|---|
| Type disagreements on `TelemetryEvent` shape | Spend 20 min agreeing on the contract before anyone writes code |
| Docker volume conflicts on Windows | Use named volumes, not bind mounts, for database data |
| Redpanda topic auto-create disabled | Set `auto_create_topics_enabled: true` in Redpanda config or pre-create topics in `scripts/setup-kafka.ts` |

---

## Phase 1

### Foundation & Sandbox Pipeline
**Timeline:** May 9–16 (Week 1, effectively days 2–7 after Phase 0)
**Primary Owner:** Engineer A
**Supporting:** Engineer B (Dockerode guidance), Engineer C (Gateway auth)

---

### Objective
A contestant can upload a code archive via HTTP, the platform containerizes it securely, and the container's running status is visible in Redis.

This phase proves the most security-critical part of the system works. Everything downstream depends on a container being live.

---

### Features / Modules to Build

#### 1.1 — API Gateway (`packages/gateway`)
**Engineer A + C**

| Task | Detail |
|---|---|
| Express app scaffolding | `src/app.ts` with middleware chain: `helmet → rate-limit → cors → json-parser` |
| JWT auth middleware | `src/middleware/auth.ts`: `jsonwebtoken.verify(token, JWT_SECRET)`, attach `req.user` |
| Rate limiting | `express-rate-limit`: 100 req/min per IP applied BEFORE auth on all routes |
| POST /submit | `multer-s3` configured to pipe directly to MinIO bucket `submissions`; generate `submissionId = uuid()`; store metadata in Redis `submission:{id}:meta` hash |
| POST /auth/login | Accept `{ username, password }`, validate against hardcoded admin credentials (env vars), return signed JWT |
| GET /runs/:id | Read `submission:{id}:status` from Redis, return JSON |
| GET /health | Return `{ status: 'ok', uptime }` — used by k8s liveness probe |
| Input validation | `zod` schemas for all request bodies; return 400 with error details on failure |
| Error handling | Global error handler middleware, never leak stack traces in production |

**Key design constraint:** Gateway never writes to local disk. It is stateless and horizontally scalable.

#### 1.2 — Sandbox Engine (`packages/sandbox`)
**Engineer A**

| Task | Detail |
|---|---|
| MinIO artifact download | `minio` client: `getObject(bucket, submissionId)` → write to temp dir |
| Language detection | Inspect archive: `.cpp` → GCC, `.rs`/`Cargo.toml` → Rust, `go.mod` → Go |
| Builder container | `docker.createContainer({ Image: 'gcc:12', ... })` — mount source read-only, compile, copy binary out |
| Runtime image build | `docker.buildImage()` from a minimal Dockerfile: `FROM alpine` + copy binary |
| Isolation config | Full config as per blueprint Section 4.2: Memory 512MB, CpusetCpus, CapDrop ALL, ReadonlyRootfs, NetworkMode sandbox-net, PidsLimit 100 |
| Health polling | Poll `http://localhost:{port}/health` every 2s, timeout after 30s → set status `error` |
| Kafka publish | On success: `producer.send({ topic: TOPICS.SUBMISSION_READY, messages: [{ value: JSON.stringify(event) }] })` |
| Redis status updates | Set `submission:{id}:status` at each lifecycle step: `queued → building → running / error` |
| Cleanup | On container stop/error: set status, publish `submission-stopped` event, delete temp files |

**Critical:** The `sandbox-net` bridge network must have outbound internet routing disabled. Add an explicit `iptables` DROP rule or use Docker's `--internal` flag on the network.

#### 1.3 — Reference Exchange (`scripts/ref-exchange/`)
**Engineer B** (can start this in parallel with 1.1 and 1.2)

This is NOT for judges. It is the development target for testing the full pipeline before we have real contestant submissions.

| Task | Detail |
|---|---|
| In-memory orderbook | `OrderBook` class: `bids` (sorted descending), `asks` (sorted ascending), each as a sorted Map |
| HTTP endpoints | `POST /order` accepting `{ type: 'LIMIT'|'MARKET'|'CANCEL', side, price?, quantity, orderId }` |
| Limit order logic | Insert into correct side, attempt match against opposite side |
| Market order logic | Walk the opposite side book until filled or book exhausted |
| Cancel logic | Remove `orderId` from book, return `{ cancelled: true/false }` |
| Response format | `{ orderId, status: 'ACCEPTED'|'FILLED'|'PARTIAL'|'REJECTED', filledQty, price }` |
| Health endpoint | `GET /health` → `{ status: 'ok' }` — sandbox polls this |
| Startup | Configurable port via env var `PORT` (default 8080) |

---

### Dependencies
- `packages/shared` must be built before gateway or sandbox can import types
- Docker Compose infra must be running before any service starts
- MinIO bucket `submissions` must exist (create in setup script)
- `sandbox-net` Docker network must be pre-created: `docker network create --internal sandbox-net`

### Expected Deliverables
- [ ] `POST /submit` with a `.zip` returns `{ submissionId: "uuid" }` with status 202
- [ ] Sandbox downloads artifact, builds container with full isolation config
- [ ] `redis-cli GET submission:{id}:status` returns `running` within 30–60s of upload
- [ ] Reference exchange responds to `POST /order` correctly
- [ ] `docker ps` shows the contestant container running with correct resource limits

### Testing & Validation
```bash
# 1. Upload reference exchange as submission
curl -X POST http://localhost:3000/submit \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@scripts/ref-exchange/ref-exchange.zip"

# 2. Poll status until running
curl http://localhost:3000/runs/{submissionId}
# Expected: { "status": "running" }

# 3. Verify container isolation
docker inspect {container_id} | grep -A5 HostConfig
# Verify: Memory=536870912, ReadonlyRootfs=true, CapDrop=ALL

# 4. Redis check
redis-cli GET submission:{submissionId}:status
# Expected: "running"
```

### Parallelization
| Task | Engineer | Can Start |
|---|---|---|
| Gateway (auth, upload) | A + C | Immediately after Phase 0 |
| Sandbox engine | A | Immediately after Phase 0 |
| Reference exchange | B | Immediately after Phase 0 |
| Docker Compose Dockerfiles | A | Immediately after Phase 0 |

### Risks & Bottlenecks
| Risk | Severity | Mitigation |
|---|---|---|
| `docker.buildImage()` Dockerode API is poorly documented | High | Prototype build API in isolation first; use `docker build` CLI via `child_process` as fallback |
| Compilation inside builder container takes >30s | Medium | Pre-pull builder images in setup script; tune health poll timeout |
| MinIO bucket not created before first upload | Low | Add bucket creation to `scripts/setup.ts` with idempotent `makeBucket` |
| sandbox-net isolation bypass on macOS | Medium | Mac uses a VM for Docker; isolation is real in Linux production, document this for judges |

---

## Phase 2

### Bot Fleet & Raw Telemetry
**Timeline:** May 17–23 (Week 2)
**Primary Owner:** Engineer B
**Supporting:** Engineer A (Kafka consumer config), Engineer C (telemetry API schema)

---

### Objective
The bot fleet fires at the reference exchange with realistic Poisson-timed traffic. Raw latency percentiles appear in the telemetry service console every second.

---

### Features / Modules to Build

#### 2.1 — Bot Fleet Orchestrator (`packages/bot-fleet`)
**Engineer B**

| Task | Detail |
|---|---|
| Kafka consumer | Subscribe to `TOPICS.SUBMISSION_READY`, consume in consumer group `bot-fleet-group` |
| Worker pool management | Spawn N `Worker` threads per `submission-ready` event (N = `BOT_COUNT` from env) |
| Worker lifecycle | `w.on('error', restartWorker)` — dead workers are restarted with backoff |
| Kafka stop signal | Subscribe to `TOPICS.SUBMISSION_STOPPED`; terminate all workers for that `submissionId` |
| Coordination | Maintain `Map<submissionId, Worker[]>` to track active fleets |
| Graceful shutdown | On `SIGTERM`: drain current orders (wait up to 5s), terminate workers, disconnect Kafka |

#### 2.2 — Bot Worker (`packages/bot-fleet/src/bot-worker.ts`)
**Engineer B**

| Task | Detail |
|---|---|
| Receive `workerData` | `{ submissionId, targetHost, targetPort, botId, lambda, scenarioConfig }` |
| Poisson timing | `poissonDelay(lambda) = -Math.log(Math.random()) / lambda * 1000` ms |
| Order generation | `generateOrder()`: randomly select LIMIT (60%), MARKET (25%), CANCEL (15%); randomize price ±5% from mid; randomize quantity 1–100 |
| HTTP send | `axios.post(`http://${host}:${port}/order`, order)` |
| WebSocket send | `ws` library: if `scenarioConfig.protocol === 'ws'`, use WebSocket connection instead |
| Timing | `const sentAt = performance.now()` before send; `const ackedAt = performance.now()` after resolved |
| Telemetry post | `parentPort.postMessage({ type: 'telemetry', payload: { submissionId, orderId, sentAt, ackedAt, orderType, filled, expectedFill } })` |
| Circuit breaker | If 10 consecutive requests fail → mark exchange as down, wait 5s, retry. Prevents worker spin-loop on crashed exchange |
| Cancel tracking | Maintain `recentOrderIds[]` ring buffer; CANCEL orders sample from this buffer |

**Improvement A (batch telemetry):** Buffer 50 events in worker, POST array to ingester instead of 1-by-1. Reduces HTTP overhead by 50x. This should be implemented from day one.

```typescript
// bot-worker.ts — batch telemetry buffer
const telemetryBuffer: TelemetryEvent[] = [];
const BATCH_SIZE = 50;

// After recording event:
telemetryBuffer.push(event);
if (telemetryBuffer.length >= BATCH_SIZE) {
  await axios.post(`${TELEMETRY_URL}/events/batch`, telemetryBuffer);
  telemetryBuffer.length = 0;
}
```

#### 2.3 — Telemetry Ingester (`packages/telemetry`)
**Engineer B + C**

| Task | Detail |
|---|---|
| Fastify server | `fastify({ logger: true })` on port 4000 |
| `POST /events` | Accept single `TelemetryEvent`, validate with Fastify's JSON schema (not zod — faster) |
| `POST /events/batch` | Accept `TelemetryEvent[]`, validate array, process all |
| HDR Histogram | `Map<submissionId, Histogram>` — `getOrCreate(submissionId)` pattern |
| Latency recording | `hist.recordValue(ackedAt - sentAt)` |
| TPS counter | `Map<submissionId, { count: number, windowStart: number }>` — reset every 1000ms |
| Flush cycle | `setInterval(flushAll, 1000)`: for each submission, extract p50/p90/p99, TPS; log to console (Phase 2); write to stores (Phase 3) |
| Correctness stubs | Log `filled` vs `expectedFill` for now; correctness computation added in Phase 3 |

**Phase 2 telemetry validation: console only.** No database writes yet. The goal is to prove data flows.

#### 2.4 — Orchestrator ↔ Telemetry Integration
**Engineer B**

| Task | Detail |
|---|---|
| Orchestrator receives telemetry from workers | `w.on('message', (msg) => { if (msg.type === 'telemetry') postToIngester(msg.payload) })` |
| OR (preferred): Worker posts directly | Worker has `TELEMETRY_URL` in `workerData` and posts directly — removes main thread bottleneck |
| Verify flow | `console.log` in ingester confirms events arriving per second |

---

### Dependencies
- Phase 1 must be complete: reference exchange must be running, Kafka must be receiving `submission-ready`
- `@iicpc/shared` `TelemetryEvent` type locked
- `TELEMETRY_URL` env var set in bot-fleet's `.env`

### Expected Deliverables
- [ ] Bot fleet spawns N workers on `submission-ready` event
- [ ] Workers fire orders at reference exchange with Poisson timing
- [ ] Telemetry ingester logs p50/p90/p99 and TPS every second per submission
- [ ] Workers cleanly stop on `submission-stopped` Kafka event
- [ ] No worker memory leak over 5-minute stress test

### Testing & Validation
```bash
# 1. Start full platform
docker compose up -d  # infra
pnpm turbo dev       # all services

# 2. Trigger pipeline manually (if sandbox is slow)
# Publish a fake submission-ready event directly to Kafka
scripts/publish-test-event.ts

# 3. Watch telemetry output
# Should see every ~1000ms:
# [telemetry] submission:abc123 p50=2.1ms p90=8.4ms p99=23.1ms TPS=847

# 4. Load test telemetry ingester directly
# Use autocannon to verify ingester handles 5000 req/s
npx autocannon -c 50 -d 10 http://localhost:4000/events
```

### Parallelization
| Task | Engineer | Can Start |
|---|---|---|
| Bot Fleet orchestrator | B | Phase 1 done |
| Bot worker HTTP | B | Phase 1 done |
| Telemetry Fastify server | B+C | Immediately after Phase 0 |
| Reference exchange hardening | B | Anytime |
| Bot worker WebSocket upgrade | B | After HTTP works |

### Risks & Bottlenecks
| Risk | Severity | Mitigation |
|---|---|---|
| worker_threads memory leak under 200 workers | High | Use `--inspect` to profile heap; cap `BOT_COUNT=50` during dev |
| Reference exchange crashes under bot load | Medium | Expected — this reveals exchange weaknesses; bot circuit breaker protects the fleet |
| `performance.now()` not monotonic across worker restarts | Low | `performance.now()` is per-isolate monotonic — restart resets the clock but latency is still delta-relative |
| Telemetry ingester overwhelmed (>5k req/s) | Medium | Implement batch endpoint immediately; upgrade to Kafka async path if needed |

---

## Phase 3

### Persistence, Scoring & Live Leaderboard
**Timeline:** May 24–30 (Week 3)
**Primary Owner:** Engineer C (TimescaleDB + scoring) + Engineer B (correctness engine)
**Supporting:** Engineer A (Redis + Leaderboard service)

---

### Objective
Every metric is persisted to TimescaleDB, composite scores are computed and stored in Redis, and the SSE endpoint returns live JSON scores every second.

This is the phase that makes the platform "real" — judges can query historical data, verify scoring formula, and see live updates.

---

### Features / Modules to Build

#### 3.1 — TimescaleDB Integration in Telemetry
**Engineer C**

| Task | Detail |
|---|---|
| `pg` pool setup | `new Pool({ connectionString: TIMESCALE_URL, max: 10 })` in `src/db.ts` |
| Batch INSERT | In flush cycle: `INSERT INTO metrics (time, submission_id, ...) VALUES ($1,$2,...),($3,$4,...) ON CONFLICT DO NOTHING` — batch 1 row per submission per second |
| Connection pool sizing | `max: 10` connections is sufficient for 1s flush intervals on <100 submissions |
| Error handling | Catch DB write errors: log + continue — never crash on DB failure |
| Schema migration | Run `pnpm migrate` before first service start — add to `docker-compose` healthcheck chain |

#### 3.2 — Redis Sorted Set (Live Scores)
**Engineer A**

| Task | Detail |
|---|---|
| `ZADD` on flush | `redis.zadd('leaderboard', compositeScore, submissionId)` every 1s |
| Composite score formula | `(0.40 * latencyScore) + (0.40 * throughputScore) + (0.20 * correctnessRate)` |
| Score normalization | Normalize latency and TPS scores against all current submissions (0–100 range): `normalize(value, allValues) = (value - min) / (max - min) * 100` |
| Snapshot state | Store full `LiveScore` as JSON: `SET submission:{id}:score <JSON>` for quick lookup |
| Cleanup | On `submission-stopped`: `ZREM leaderboard submissionId` |

#### 3.3 — Reference Matching Engine (Correctness Validation)
**Engineer B**

This is a pure TypeScript class — NOT a separate container. It runs synchronously inside the telemetry service.

| Task | Detail |
|---|---|
| `ReferenceEngine` class | `src/reference-engine.ts`: maintains identical orderbook state per submission |
| Order replay | For each `MARKET` order event arriving at ingester: replay the same order through reference engine |
| Fill comparison | `correct = (event.filled === referenceEngine.fill(order))` |
| Correctness tracking | `Map<submissionId, { correct: number, total: number }>` |
| Rate calculation | `correctnessRate = (correct / total) * 100` — included in every flush |
| Edge cases | Handle: zero-quantity fills, partial fills, cancel of non-existent order |

**Important:** The reference engine must maintain state in sync with the contestant's exchange. This means processing orders in the same order bots sent them. Since bots are parallel, there is inherent ordering non-determinism — log violations with `orderId` for judge review rather than penalizing heavily.

#### 3.4 — Leaderboard Service (`packages/leaderboard`)
**Engineer A + C**

| Task | Detail |
|---|---|
| Express app | Port 4001, `src/app.ts` with `helmet` and `cors` |
| `GET /scores/stream` | SSE implementation: `Content-Type: text/event-stream`, `setInterval` every 1s, `ZRANGEBYSCORE leaderboard -inf +inf WITHSCORES LIMIT 0 50` |
| SSE format | `data: ${JSON.stringify(rankings)}\n\n` — each item is `{ rank, submissionId, ...LiveScore }` |
| Client disconnect | `req.on('close', () => clearInterval(interval))` — critical to prevent memory leak |
| `GET /metrics/:submissionId` | TimescaleDB query: last 5 minutes of data for submission detail charts |
| `GET /scores/snapshot` | Return current top 50 as JSON (for initial page load before SSE connects) |
| Connection limit | Track connected SSE clients; reject >100 connections with 503 |

**Improvement J (rate limit telemetry):** Add per-submissionId rate limiting in telemetry ingester to prevent a single runaway bot from flooding the ingester:
```typescript
// Max 10,000 events/sec per submission
const rateLimiter = new Map<string, number>(); // submissionId → count in window
```

---

### Dependencies
- Phase 2 must be complete: telemetry flush cycle must exist (we're extending it)
- TimescaleDB migration must be applied
- Redis must be running
- `hdr-histogram-js` installed in telemetry package

### Expected Deliverables
- [ ] `psql $TIMESCALE_URL -c "SELECT * FROM metrics ORDER BY time DESC LIMIT 5"` returns rows every second
- [ ] `redis-cli ZRANGEBYSCORE leaderboard -inf +inf WITHSCORES` shows live scores
- [ ] `curl -N http://localhost:4001/scores/stream` streams JSON updates every second
- [ ] Correctness rate appears in leaderboard payload (may be 100% until validation finds issues)
- [ ] No memory leak in leaderboard service under 10 concurrent SSE clients

### Testing & Validation
```bash
# 1. Verify TimescaleDB rows accumulating
watch -n 1 'psql $TIMESCALE_URL -c "SELECT COUNT(*) FROM metrics"'

# 2. Verify Redis leaderboard
redis-cli ZRANGEBYSCORE leaderboard -inf +inf WITHSCORES

# 3. Verify SSE stream
curl -N http://localhost:4001/scores/stream
# Should print JSON every 1s:
# data: [{"rank":1,"submissionId":"abc","latencyP99":12.3,"tps":947,"compositeScore":78.4}]

# 4. Verify correctness scoring
# Submit two orders manually to reference exchange, compare fills in telemetry logs
```

### Parallelization
| Task | Engineer | Can Start |
|---|---|---|
| TimescaleDB integration | C | Phase 2 flush cycle exists |
| Redis ZADD + scoring formula | A | Phase 2 flush cycle exists |
| Reference matching engine | B | Phase 2 done (TelemetryEvent has `filled`/`expectedFill`) |
| Leaderboard Service | A+C | Can stub with hardcoded data until scoring is ready |

### Risks & Bottlenecks
| Risk | Severity | Mitigation |
|---|---|---|
| Scoring normalization breaks with single submission (divide by zero) | Medium | `if (allValues.length < 2) return 50` — default normalized score |
| Reference engine state diverges from contestant exchange (lost orders) | High | Log divergence; don't fail hard — mark as "unvalidatable" rather than incorrect |
| TimescaleDB insert bottleneck at high TPS | Medium | Batch 100 rows per INSERT; tune `shared_buffers = 256MB` in TimescaleDB config |
| SSE connection leak if client doesn't close cleanly | Medium | Add TTL cleanup: forcibly close SSE connections idle >5 min |

---

## Phase 4

### React Dashboard & Full Integration
**Timeline:** May 31 – June 6 (Week 4)
**Primary Owner:** Engineer C (Frontend)
**Supporting:** Engineer A (API proxy config), Engineer B (end-to-end test)

---

### Objective
The complete platform works end-to-end with a polished frontend. A full demo run — upload, containerize, bots fire, live leaderboard updates — is visible entirely in the browser without touching the terminal.

---

### Features / Modules to Build

#### 4.1 — React Project Setup (`frontend/`)
**Engineer C**

| Task | Detail |
|---|---|
| Vite scaffold | `pnpm create vite frontend --template react-ts` |
| Dependencies | `recharts`, `@tanstack/react-query`, `axios`, `react-dropzone`, `react-router-dom` |
| Vite proxy | `vite.config.ts`: `/api → http://localhost:3000`, `/stream → http://localhost:4001` |
| Global styles | Tailwind CSS (`@tailwindcss/vite` plugin) — fast utility styling, zero custom CSS needed |
| Router | `react-router-dom` with routes: `/` (leaderboard), `/submission/:id`, `/submit`, `/admin` |

#### 4.2 — Leaderboard Page (`/`)
**Engineer C**

| Task | Detail |
|---|---|
| `useLeaderboard` hook | `EventSource('/stream/scores/stream')`, `onmessage` → parse JSON, set state |
| Auto-reconnect | `onerror → es.close() → setTimeout(connect, 3000)` |
| `RankingTable` | Columns: Rank, Submission ID (truncated), p99 Latency, TPS, Correctness, Score |
| Row animation | CSS `transition: background-color 0.3s` on rows that change rank position |
| `LiveBadge` | Pulsing green dot indicating SSE is connected |
| `ScoreTrend` sparkline | Last 10 score snapshots as a tiny Recharts `LineChart` inline in each row |
| Empty state | "Waiting for submissions..." when leaderboard is empty |

#### 4.3 — Submission Detail Page (`/submission/:id`)
**Engineer C**

| Task | Detail |
|---|---|
| `useMetrics` hook | `react-query` polling `GET /api/metrics/:id` every 5s |
| Latency chart | Recharts `LineChart` with 3 lines: p50 (green), p90 (yellow), p99 (red) over time |
| TPS chart | Recharts `AreaChart` — TPS over time |
| Correctness bar | Progress bar: `{correctnessRate}%` with pass/fail counts |
| Status badge | Current submission status from `GET /api/runs/:id` |

#### 4.4 — Submit Page (`/submit`)
**Engineer C**

| Task | Detail |
|---|---|
| `FileDropzone` | `react-dropzone` accepting `.zip`, `.tar.gz` only |
| Language selector | Dropdown: C++, Rust, Go |
| Upload progress | Axios `onUploadProgress` → progress bar percentage |
| Pipeline tracker | Steps: Uploading (→ 202) → Building (status=building) → Running (status=running) → Live (SSE active) |
| Status polling | `useQuery` polling `GET /api/runs/:id` every 2s, drives tracker state |
| JWT flow | For hackathon: embed a hardcoded demo token in frontend `.env.local` |

#### 4.5 — Admin Panel (`/admin`)
**Engineer C** (Improvement E)

| Task | Detail |
|---|---|
| Container status list | Table of all active submissions and their status from Redis |
| Stop run button | `POST /api/admin/stop/:submissionId` → publishes `submission-stopped` Kafka event |
| Bot count display | Shows active worker count per submission |
| Manual trigger | "Trigger test submission" button for demo purposes |

#### 4.6 — Gateway Admin Routes
**Engineer A**

| Task | Detail |
|---|---|
| `POST /admin/stop/:id` | Requires admin JWT role; publishes `submission-stopped` to Redpanda; sets Redis status to `stopped` |
| `GET /admin/submissions` | Returns all `submission:*:status` keys from Redis |

#### 4.7 — Full End-to-End Integration Test
**Engineer B**

| Task | Detail |
|---|---|
| Real submission | Compile a simple C++ orderbook (open-source stub), zip and upload via browser |
| Pipeline watch | Monitor all service logs during the run |
| Leaderboard confirm | Submission appears in leaderboard within 60s of upload |
| Chart confirm | Latency charts populate with real data |
| Stop confirm | Admin "stop" button cleanly terminates bot fleet |
| Regression notes | Document any bugs found; fix before Phase 5 |

---

### Dependencies
- Phase 3 must be complete: SSE endpoint and `/metrics/:id` endpoint must be live
- All services running via `pnpm turbo dev`
- Vite proxy correctly configured to reach gateway (port 3000) and leaderboard (port 4001)

### Expected Deliverables
- [ ] Full browser demo: upload → container live → bots firing → live leaderboard updating
- [ ] Submission detail page shows real latency charts
- [ ] Submit page progress tracker correctly reflects pipeline state
- [ ] Admin stop button cleanly terminates a run
- [ ] No visible errors in browser console during demo

### Testing & Validation
```bash
# 1. Start everything
docker compose up -d && pnpm turbo dev

# 2. Open browser at http://localhost:5173
# 3. Navigate to /submit, drop in a zip file, select C++
# 4. Watch progress tracker advance through stages
# 5. Navigate to / — submission should appear in leaderboard within 60s
# 6. Click submission row → /submission/:id — charts should show live data
# 7. Admin panel → stop the run → leaderboard should remove entry

# Lighthouse audit (demo polish):
# Performance > 90, no obvious render jank
```

### Parallelization
| Task | Engineer | Can Start |
|---|---|---|
| React setup + Router + Tailwind | C | Start of Phase 4 |
| Leaderboard page | C | After SSE endpoint confirmed working |
| Submission detail page | C | After `/metrics/:id` endpoint works |
| Submit page | C | After gateway upload confirmed |
| Admin routes on gateway | A | Phase 3 leaderboard service done |
| End-to-end test | B | After all Phase 4 components done |

### Risks & Bottlenecks
| Risk | Severity | Mitigation |
|---|---|---|
| CORS issues between frontend and services | Medium | Add explicit CORS config on gateway and leaderboard for `localhost:5173` |
| SSE proxy through Vite drops connection | Medium | Configure `proxy: { '/stream': { changeOrigin: true, ws: true } }` in Vite |
| React re-renders too fast on SSE updates (jank) | Medium | Wrap `setRankings` in `useCallback`; use `useMemo` for sort; throttle updates to 2/s max |
| Demo JWT expires during demo | Low | Set JWT expiry to `30d` for demo token |

---

## Phase 5

### Hardening, IaC & Submission Polish
**Timeline:** June 7–10 (Final 4 days)
**Primary Owner:** Engineer A (IaC, k8s), Engineer B (resilience), Engineer C (blueprint doc)
**All engineers:** Demo preparation

---

### Objective
Platform is production-hardened. k8s manifests deploy cleanly. Architecture Blueprint is polished. Demo run works in under 2 minutes from cold start. Submission is ready.

---

### Features / Modules to Build

#### 5.1 — Kubernetes Manifests (`infra/k8s/`)
**Engineer A**

| File | Contents |
|---|---|
| `namespace.yaml` | `iicpc` namespace for isolation |
| `gateway-deployment.yaml` | Deployment + Service, replicas: 2, liveness probe on `/health` |
| `sandbox-deployment.yaml` | Deployment, replicas: 1, volume mount for Docker socket |
| `bot-fleet-deployment.yaml` | Deployment, replicas: 3, env `BOT_COUNT=500` |
| `telemetry-deployment.yaml` | Deployment, replicas: 2, resource limits |
| `leaderboard-deployment.yaml` | Deployment, replicas: 2 |
| `bot-fleet-hpa.yaml` | HPA: min 2, max 10, target CPU 70% |
| `configmap.yaml` | Non-secret env vars (Kafka brokers, service URLs) |
| `secrets.yaml` | (gitignored) JWT_SECRET, MinIO credentials — use k8s Secrets |
| `redis-statefulset.yaml` | StatefulSet + PVC for Redis persistence |
| `timescaledb-statefulset.yaml` | StatefulSet + PVC for TimescaleDB |
| `ingress.yaml` | NGINX ingress routing `/api → gateway`, `/stream → leaderboard`, `/ → frontend` |

**Validation:**
```bash
kubectl apply -f infra/k8s/
kubectl get pods -n iicpc  # all Running
kubectl get hpa -n iicpc   # bot-fleet HPA active
```

#### 5.2 — Resilience Hardening
**Engineer B**

| Task | Detail |
|---|---|
| Kafka dead-letter handling | Consumer: `try/catch` around message processing; on error: log, commit offset, continue |
| Container watchdog | Sandbox: `docker.getContainer(id).wait()` → on exit, update Redis status, publish stopped event |
| SSE reconnection | Frontend: exponential backoff reconnect (1s, 2s, 4s, 8s, max 30s) |
| Graceful shutdown | All services: `process.on('SIGTERM', gracefulShutdown)` — drain in-flight requests, close Kafka connections, close DB pool |
| Telemetry ingester backpressure | Use Fastify's built-in `maxParamLength` + global rate limiter: if queue depth > 10k events, return 429 |
| Container auto-cleanup (Improvement F) | `scripts/gc-containers.ts`: list stopped containers older than 15 min, remove them |

#### 5.3 — Architecture Blueprint Document
**Engineer C** (This file is an IICPC deliverable)

| Task | Detail |
|---|---|
| Finalize `docs/blueprint.md` | Verify all code snippets match actual implementation |
| API surface documentation | For each service: list all endpoints, request/response schemas, env vars |
| Kafka topic documentation | Table: topic name, producer, consumer, message schema |
| Isolation strategy | Copy exact Dockerode config with annotations explaining each flag |
| Scoring formula | Document weights, normalization approach, and rationale |
| Architecture diagram | ASCII or draw.io diagram showing full system flow |
| IICPC requirements matrix | Ensure every requirement maps to an implemented component (reference Section 1 of this document) |
| `README.md` | One-command startup guide: `docker compose up`, expected output, demo walkthrough |

#### 5.4 — Demo Preparation
**All engineers**

| Task | Detail |
|---|---|
| Cold start script | `scripts/demo-start.sh`: `docker compose down -v && docker compose up -d && pnpm turbo build && pnpm turbo start` — must complete in <2 minutes |
| Pre-seeded demo submission | Compile a C++ orderbook, name it `demo-submission.zip`, commit to `scripts/demo/` |
| Demo JWT | Hardcode a never-expiring JWT for demo use — document it in README |
| Walkthrough script | Written 5-minute script: what to click, what to say, what metric to highlight |
| Backup plan | If live Docker build fails during demo: pre-pull all images, have a pre-built container ready to start |
| Architecture diagram | One-page printed diagram for verbal explanation |

---

### Expected Deliverables
- [ ] `kubectl apply -f infra/k8s/` deploys entire platform to a cluster
- [ ] `kubectl get hpa -n iicpc` shows bot-fleet HPA
- [ ] `docker compose up` starts entire platform in <2 minutes
- [ ] All services survive 10-minute continuous load test without crash or memory leak
- [ ] `docs/blueprint.md` is complete with all sections verified against actual code
- [ ] `README.md` has one-command startup and demo walkthrough
- [ ] Submission zip prepared with: source code, IaC, blueprint, README

### Testing & Validation
```bash
# Cold start test (must complete in <2 minutes)
time docker compose down -v && docker compose up -d

# Load test (10-minute resilience check)
# All services must remain responsive
scripts/load-test.sh --duration 600

# Memory leak check
docker stats  # all containers should show stable memory over 10 min

# k8s smoke test
kubectl apply -f infra/k8s/ --dry-run=client  # zero errors

# Final demo run
# Upload demo-submission.zip, watch full pipeline, verify leaderboard
```

### Parallelization
| Task | Engineer | Can Start |
|---|---|---|
| k8s manifests | A | Start of Phase 5 |
| Graceful shutdown + watchdog | B | Start of Phase 5 |
| Blueprint finalization | C | Start of Phase 5 |
| Demo script prep | All | After k8s and hardening done |

### Risks & Bottlenecks
| Risk | Severity | Mitigation |
|---|---|---|
| k8s cluster not available for testing | High | Use `minikube` or `kind` locally; document that manifests are validated with `--dry-run=client` |
| Cold start takes >2 min due to image builds | High | Pre-build and push images; use `docker compose pull` in demo script |
| Blueprint sections don't match actual implementation | Medium | Blueprint review session: engineer A reads code, engineer C reads blueprint — reconcile |
| Submission zip too large for upload portal | Low | Exclude `node_modules/` and `dist/` from zip |

---

## 12. Demo Day Checklist

**Critical for demo (must work flawlessly):**
- [ ] `docker compose up -d` starts all services in <2 minutes
- [ ] File upload completes with 202 response
- [ ] Sandbox builds and starts container (visible in `docker ps`)
- [ ] Bot fleet spawns and fires (visible in telemetry logs)
- [ ] Live leaderboard updates in browser (SSE working)
- [ ] Latency charts show real p50/p90/p99 data

**Important for judges (must work but can have minor rough edges):**
- [ ] Correctness rate appears in scores (even if 100%)
- [ ] Stop run button terminates bots cleanly
- [ ] Submission detail page shows charts
- [ ] k8s manifests apply without errors (`--dry-run`)
- [ ] Architecture Blueprint document is polished

**Nice-to-have (demo if time allows):**
- [ ] Admin panel with bot count slider
- [ ] Prometheus/Grafana export
- [ ] Multiple simultaneous submissions competing
- [ ] Helm chart for k8s deployment

---

## 13. Simplification Guide (If Time Runs Short)

If the team falls behind, apply these simplifications in order. Each removes complexity while preserving the core demo.

| Cut | What You Lose | How to Compensate |
|---|---|---|
| Skip MinIO, write uploads to `/tmp` | Stateless gateway scalability | Note in blueprint as "production improvement" |
| Skip WebSocket bot support | FIX/WS support claim | HTTP REST still satisfies requirement; document as "REST + WS planned" |
| Replace HDR histogram with simple array sort | O(1) memory claim | Still produces correct percentiles; note in blueprint as "production optimization pending" |
| Stub correctness rate at 100% | Correctness validation | Comment out reference engine; set `correctnessRate = 100`; note as "Phase 5 enhancement" |
| Replace SSE with 3s polling | True real-time claim | Frontend polls `GET /scores/snapshot` every 3s; almost identical UX |
| Skip TimescaleDB, use Redis hashes for history | Historical chart data | Charts show only last 50 data points from Redis instead of full history |
| Skip k8s manifests | IaC deliverable | Submit Docker Compose as IaC; write a 1-page k8s design doc explaining what the manifests would look like |
| Skip submission detail charts | Per-submission analysis | Link to raw JSON API instead |
| Hardcode one contestant submission | Multi-tenant support | Demonstrate with the reference exchange as the "contestant" |

---

## 14. Production-Grade Improvements (If Extra Time Remains)

If the team finishes early, these improvements demonstrate production-grade thinking to judges:

| Improvement | Engineering Value | Effort |
|---|---|---|
| **Kafka async telemetry path** — bots publish to `telemetry-events` topic; ingester consumes | Decouples bot latency from ingester load; handles backpressure via Kafka offset lag | 4 hours |
| **Prometheus metrics export** — expose `/metrics` on each service in Prometheus format | Judges can see real-time CPU, memory, request rate per service | 3 hours |
| **Grafana dashboard** — connect Grafana to Prometheus + TimescaleDB | Visual proof of scale; spectacular demo element | 2 hours |
| **Multi-region bot fleet simulation** — add `region` field to bot workers, tag telemetry | Demonstrates geographic distribution thinking | 3 hours |
| **Submission queue with Redis list** — LPUSH/BRPOP queue for sandbox jobs | Prevents sandbox overload; fair ordering under concurrent uploads | 3 hours |
| **Contestant SDK** — publish a TypeScript/Rust/C++ scaffold with the expected HTTP interface | Reduces time for judges to test with their own exchange | 4 hours |
| **Rate of change scoring** — bonus points for improving p99 across runs | Rewards optimization iteration, not just raw performance | 2 hours |
| **Helm chart** — parameterize all k8s values via Helm values.yaml | Single `helm install iicpc ./chart` command; professional IaC delivery | 4 hours |
| **OpenAPI spec** — `swagger-jsdoc` on gateway and leaderboard service | Self-documenting API for judges to explore | 2 hours |
| **Container pre-warm pool** — pre-start N builder containers on platform boot | Reduces container build latency from ~30s to ~5s | 4 hours |

---

## 15. Overall Risk Register

Consolidated view of the highest-severity risks across all phases:

| Risk | Phase | Severity | Owner | Mitigation |
|---|---|---|---|---|
| Docker-in-Docker sandbox escape | 1 | Critical | A | `sandbox-net --internal`, `CapDrop ALL`, `ReadonlyRootfs`, document DinD security tradeoff |
| Kafka consumer group rebalance during demo | 2 | High | B | Single consumer group per service; `maxInFlightRequests: 1` during demo |
| Clock skew invalidating latency measurements | 2 | High | B | Use `performance.now()` (monotonic) on bot side only; never use wall clock |
| TimescaleDB write bottleneck >1000 submissions/s | 3 | High | C | Batch INSERT; connection pool; tune `shared_buffers`; async write queue |
| Shared type changes breaking multiple services | All | High | All | Type changes require PR + review; never change `TelemetryEvent` or `Submission` shapes after Phase 0 |
| Demo container build fails live | 5 | High | A | Pre-build images; have fallback `docker run` command for pre-built container |
| Memory leak in bot worker threads | 2 | Medium | B | Limit `BOT_COUNT=200` max per pod; test 5-minute continuous runs in Phase 2 |
| SSE connection leak on client disconnect | 3 | Medium | A | `req.on('close', cleanup)`; add connection count monitoring |
| Incorrect scoring formula (division by zero) | 3 | Medium | C | Guard: if single submission, assign score 75; test with 1 and 2 submissions |
| k8s cluster unavailable for live demo | 5 | Medium | A | Validate with `--dry-run=client`; use minikube if needed; Docker Compose is primary demo vehicle |

---

*End of Phase Planner*
*IICPC Summer Hackathon 2026 | May 9 – June 10, 2026*
*Distributed Benchmarking & Hosting Platform*
