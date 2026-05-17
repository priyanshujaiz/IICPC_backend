# IICPC Platform — Database Design
**All three data stores: TimescaleDB · Redis · MinIO**

---

## Table of Contents

1. [Overview — Three-Store Architecture](#1-overview)
2. [TimescaleDB — Persistent Relational + Time-Series](#2-timescaledb)
3. [Redis — Live Ephemeral State](#3-redis)
4. [MinIO — Binary Artifact Storage](#4-minio)
5. [TypeScript Types — Aligned to Stores](#5-typescript-types)
6. [Service → Store Access Map](#6-service--store-access-map)
7. [Data Flow Through Stores (End to End)](#7-data-flow-through-stores)
8. [Migration Files](#8-migration-files)

---

## 1. Overview

Each store has a single, non-overlapping responsibility. Data is never duplicated across stores unless there is an explicit, justified reason.

| Store | Role | Persistence | Used By |
|---|---|---|---|
| **TimescaleDB** | Durable submission metadata + full time-series metric history | Permanent (volume-backed) | gateway (write meta), telemetry (write metrics), leaderboard (read charts) |
| **Redis** | Live leaderboard ranking + real-time submission status + bot coordination signals | Ephemeral (in-memory, TTL) | sandbox (write status), telemetry (write scores), leaderboard (read scores), bot-fleet (read stop signals) |
| **MinIO** | Raw uploaded code archives (.zip / .tar.gz) | Permanent (volume-backed) | gateway (write), sandbox (read) |

**Design rule:** Redis holds *current state* only. TimescaleDB holds *history*. MinIO holds *binaries*. If Redis is restarted, the platform rebuilds live state from TimescaleDB. No business logic should depend on Redis being the only source of truth for anything except real-time ranking and status.

---

## 2. TimescaleDB

TimescaleDB is a PostgreSQL extension. Everything here is standard SQL. Two tables exist: `submissions` (regular table) and `metrics` (hypertable partitioned by time).

### 2.1 `submissions` Table

Stores one row per submission. Created by the gateway when a file is uploaded. This is the **durable source of truth** for submission identity — Redis caches it for fast access, but this table survives a Redis restart.

```sql
CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT        PRIMARY KEY,
  contestant_id   TEXT        NOT NULL,
  language        TEXT        NOT NULL CHECK (language IN ('cpp', 'rust', 'go')),
  artifact_path   TEXT        NOT NULL,       -- MinIO object key: {id}/{filename}
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','building','running','stopped','error')),
  container_host  TEXT,                        -- set by sandbox after container starts
  container_port  INTEGER,                     -- set by sandbox after container starts
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,                 -- when container reached running
  stopped_at      TIMESTAMPTZ                  -- when run ended
);

CREATE INDEX IF NOT EXISTS idx_submissions_contestant
  ON submissions (contestant_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions (status);
```

**Who writes:**
- `gateway` — INSERT on upload (status = 'queued')
- `sandbox` — UPDATE status, container_host, container_port, started_at
- `gateway` admin stop route — UPDATE status = 'stopped', stopped_at

**Who reads:**
- `gateway` — GET /runs/:id polls this (fallback when Redis miss)
- `leaderboard` — JOIN with metrics for submission detail page

---

### 2.2 `metrics` Table (Hypertable)

One row per submission per second. Written by the telemetry ingester every flush cycle. This is the data powering the submission detail charts.

```sql
CREATE TABLE IF NOT EXISTS metrics (
  time             TIMESTAMPTZ  NOT NULL,
  submission_id    TEXT         NOT NULL,       -- FK to submissions.id (soft, no constraint for perf)
  latency_p50      FLOAT        NOT NULL,       -- ms
  latency_p90      FLOAT        NOT NULL,       -- ms
  latency_p99      FLOAT        NOT NULL,       -- ms
  tps              FLOAT        NOT NULL,       -- events per second in this window
  correctness_rate FLOAT        NOT NULL,       -- 0.0 to 100.0
  composite_score  FLOAT        NOT NULL,       -- 0.0 to 100.0 (weighted formula)
  total_orders     BIGINT       NOT NULL,       -- cumulative orders processed
  correct_fills    BIGINT       NOT NULL,       -- cumulative correct MARKET fills
  total_fills      BIGINT       NOT NULL        -- cumulative total MARKET fills
);

-- Convert to hypertable: auto-partitions by time (7-day chunks)
SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE);

-- Primary query pattern: get last N minutes of data for a specific submission
CREATE INDEX IF NOT EXISTS idx_metrics_submission
  ON metrics (submission_id, time DESC);
```

**Why no FK constraint to `submissions.id`:** TimescaleDB hypertables do not support foreign key constraints involving the time dimension. We enforce consistency at the application layer (telemetry only writes for known submission IDs).

**Why `total_orders`, `correct_fills`, `total_fills` columns:** These allow the frontend to render accurate cumulative correctness rates over time without re-querying all rows. The telemetry service tracks running totals and writes them with each flush.

**Who writes:**
- `telemetry` — INSERT 1 row per submission per 1000ms flush cycle

**Who reads:**
- `leaderboard` — `GET /metrics/:submissionId` for last 5 minutes of chart data
- `leaderboard` — at startup, rebuild Redis leaderboard from latest metrics if Redis is empty

**Key queries:**

```sql
-- Last 5 minutes of data for submission detail charts
SELECT time, latency_p50, latency_p90, latency_p99, tps, correctness_rate, composite_score
FROM metrics
WHERE submission_id = $1
  AND time > NOW() - INTERVAL '5 minutes'
ORDER BY time ASC;

-- Latest single snapshot (for leaderboard rebuild after Redis restart)
SELECT DISTINCT ON (submission_id)
  submission_id, latency_p50, latency_p90, latency_p99,
  tps, correctness_rate, composite_score
FROM metrics
ORDER BY submission_id, time DESC;

-- Best composite score ever for a submission (for final ranking)
SELECT submission_id, MAX(composite_score) AS peak_score
FROM metrics
GROUP BY submission_id
ORDER BY peak_score DESC;
```

---

### 2.3 Full Schema Summary

```
TimescaleDB: iicpc
├── submissions          (regular table)   — 1 row per upload
│   ├── id (PK)
│   ├── contestant_id
│   ├── language
│   ├── artifact_path
│   ├── status
│   ├── container_host
│   ├── container_port
│   ├── submitted_at
│   ├── started_at
│   └── stopped_at
│
└── metrics              (hypertable)      — 1 row per submission per second
    ├── time (partition key)
    ├── submission_id
    ├── latency_p50
    ├── latency_p90
    ├── latency_p99
    ├── tps
    ├── correctness_rate
    ├── composite_score
    ├── total_orders
    ├── correct_fills
    └── total_fills
```

---

## 3. Redis

Redis stores *live* state only. Everything in Redis can be reconstructed from TimescaleDB if lost. Use a TTL on all keys that are not the leaderboard sorted set.

### 3.1 Key Pattern Reference

| Key Pattern | Type | TTL | Contents | Set By | Read By |
|---|---|---|---|---|---|
| `leaderboard` | Sorted Set | None | member=`submissionId`, score=`compositeScore` | telemetry | leaderboard |
| `submission:{id}:status` | String | 24h | `queued \| building \| running \| stopped \| error` | sandbox, gateway | gateway |
| `submission:{id}:meta` | Hash | 24h | `contestantId`, `language`, `submittedAt`, `artifactPath` | gateway | gateway, leaderboard |
| `submission:{id}:score` | String (JSON) | 24h | Full `LiveScore` JSON for fast detail lookup | telemetry | leaderboard |
| `fleet:stop:{id}` | String | 30s TTL | `"1"` — presence signals bots to stop | gateway admin | bot-fleet workers |

### 3.2 Sorted Set — `leaderboard`

The core live ranking structure. O(log N) insert, O(N) full read.

```
ZADD leaderboard <compositeScore> <submissionId>
ZRANGEBYSCORE leaderboard -inf +inf WITHSCORES LIMIT 0 50
ZREM leaderboard <submissionId>      -- on submission stopped
```

Score is a float 0–100. Higher is better. `ZRANGEBYSCORE` returns in ascending order — the leaderboard service reverses it for descending rank display.

### 3.3 Hash — `submission:{id}:meta`

```
HSET submission:{id}:meta
  contestantId  "alice"
  language      "cpp"
  submittedAt   "1747453200000"   -- epoch ms
  artifactPath  "{id}/submission.zip"

HGETALL submission:{id}:meta
```

### 3.4 String — `submission:{id}:status`

Simple string set. Gateway polls this for `GET /runs/:id`.

```
SET submission:{id}:status "building" EX 86400
SET submission:{id}:status "running"  EX 86400
SET submission:{id}:status "stopped"  EX 86400
```

### 3.5 String — `submission:{id}:score` (JSON snapshot)

Full `LiveScore` serialized as JSON. Allows leaderboard service to serve a snapshot without querying TimescaleDB on each SSE tick.

```
SET submission:{id}:score '{"latencyP50":1.2,"latencyP90":4.1,"latencyP99":11.3,"tps":847,"correctnessRate":98.4,"compositeScore":76.8}' EX 86400
```

### 3.6 String with TTL — `fleet:stop:{id}`

Bot workers poll this key every N orders. If it exists, they drain and terminate. The gateway admin route sets it with a short TTL so it self-cleans.

```
SET fleet:stop:{submissionId} "1" EX 30
```

---

## 4. MinIO

MinIO is an S3-compatible object store. It holds only the raw uploaded code archives — nothing else.

### 4.1 Bucket

| Bucket | Access | Purpose |
|---|---|---|
| `submissions` | Private (gateway + sandbox only) | Uploaded code archives |

Create the bucket on platform boot in `scripts/setup.ts`:
```typescript
await minioClient.makeBucket('submissions', 'us-east-1');
```

### 4.2 Object Key Pattern

```
{submissionId}/{original-filename}

Examples:
  3f7a1b2c-8e4d-4f6a-9b3c-1a2b3c4d5e6f/orderbook.zip
  7d9e2f4b-1c3a-5e7f-8d2b-9a1b3c5d7e9f/exchange.tar.gz
```

The `submissionId` is generated by the gateway at upload time (UUID v4). The original filename is preserved as-is for language detection downstream.

### 4.3 Access Patterns

| Operation | Who | When |
|---|---|---|
| `putObject(bucket, key, stream)` | gateway | On `POST /submit` — streams multipart directly |
| `getObject(bucket, key)` | sandbox | When building container — downloads to temp dir |
| `removeObject(bucket, key)` | sandbox | After container is running — artifact no longer needed |

Sandbox removes the artifact from MinIO after successfully starting the container, to keep storage clean. The compiled binary lives only inside the container.

---

## 5. TypeScript Types — Aligned to Stores

These are the correct types that `packages/shared/src/types.ts` must define. **The current `types.ts` is wrong** — it uses `userId`, `problemId`, `code` (CP-judge model). These are the replacements that align with the actual data stores above.

```typescript
// packages/shared/src/types.ts

// ─── TimescaleDB: submissions table ────────────────────────────────────────

export interface Submission {
  id: string;                                                    // UUID v4
  contestantId: string;                                          // from JWT sub claim
  language: 'cpp' | 'rust' | 'go';
  artifactPath: string;                                          // MinIO key: {id}/{filename}
  status: 'queued' | 'building' | 'running' | 'stopped' | 'error';
  containerHost?: string;                                        // set after container starts
  containerPort?: number;                                        // set after container starts
  submittedAt: number;                                           // epoch ms
  startedAt?: number;                                            // epoch ms
  stoppedAt?: number;                                            // epoch ms
}

// ─── TimescaleDB: metrics hypertable (1 row per second per submission) ─────

export interface MetricSnapshot {
  time: number;                                                  // epoch ms (hypertable key)
  submissionId: string;
  latencyP50: number;                                            // ms
  latencyP90: number;                                            // ms
  latencyP99: number;                                            // ms
  tps: number;                                                   // orders per second
  correctnessRate: number;                                       // 0–100
  compositeScore: number;                                        // 0–100
  totalOrders: number;                                           // cumulative
  correctFills: number;                                          // cumulative
  totalFills: number;                                            // cumulative
}

// ─── Redis: leaderboard sorted set + score snapshot ────────────────────────

export interface LiveScore {
  submissionId: string;
  latencyP50: number;
  latencyP90: number;
  latencyP99: number;
  tps: number;
  correctnessRate: number;
  compositeScore: number;                                        // score in the sorted set
}

// ─── Kafka: submission.ready topic (sandbox → bot-fleet) ───────────────────

export interface SubmissionReadyEvent {
  submissionId: string;
  host: string;                                                  // container reachable host
  port: number;                                                  // container exposed port
}

// ─── Kafka: submission.stopped topic (gateway → bot-fleet) ─────────────────

export interface SubmissionStoppedEvent {
  submissionId: string;
  reason: 'manual_stop' | 'timeout' | 'error';
}

// ─── Bot worker → Telemetry Ingester (HTTP POST /events/batch) ─────────────

export interface TelemetryEvent {
  submissionId: string;
  orderId: string;
  sentAt: number;                                                // performance.now() ms
  ackedAt: number;                                               // performance.now() ms
  orderType: 'LIMIT' | 'MARKET' | 'CANCEL';
  filled: number;                                                // actual fill qty from exchange
  expectedFill: number;                                          // reference engine fill qty
}
```

---

## 6. Service → Store Access Map

Shows exactly which service touches which store, with the operation type.

```
┌──────────────┬─────────────────────────────────────────────────────────────────────────┐
│  Service     │  Store Operations                                                       │
├──────────────┼─────────────────────────────────────────────────────────────────────────┤
│  gateway     │  TimescaleDB: INSERT submissions (on upload)                            │
│              │  TimescaleDB: UPDATE submissions.status (admin stop)                    │
│              │  Redis:       SET submission:{id}:status  EX 24h                        │
│              │  Redis:       HSET submission:{id}:meta   EX 24h                        │
│              │  Redis:       SET fleet:stop:{id} "1"     EX 30s  (admin stop)          │
│              │  Redis:       GET submission:{id}:status  (GET /runs/:id)               │
│              │  MinIO:       putObject (stream upload)                                 │
├──────────────┼─────────────────────────────────────────────────────────────────────────┤
│  sandbox     │  TimescaleDB: UPDATE submissions (container_host, port, started_at)     │
│              │  Redis:       SET submission:{id}:status building/running/error         │
│              │  MinIO:       getObject (download artifact)                             │
│              │  MinIO:       removeObject (cleanup after container starts)             │
│              │  Kafka:       PRODUCE submission.ready                                  │
│              │  Kafka:       PRODUCE submission.stopped (on container exit/error)      │
├──────────────┼─────────────────────────────────────────────────────────────────────────┤
│  bot-fleet   │  Kafka:       CONSUME submission.ready  (spawn worker threads)          │
│              │  Kafka:       CONSUME submission.stopped (terminate workers)            │
│              │  Redis:       GET fleet:stop:{id}  (workers poll to check stop signal)  │
│              │  [no TimescaleDB, no MinIO access]                                      │
├──────────────┼─────────────────────────────────────────────────────────────────────────┤
│  telemetry   │  TimescaleDB: INSERT metrics (batch, every 1s flush)                   │
│              │  Redis:       ZADD leaderboard <score> <submissionId>                   │
│              │  Redis:       SET  submission:{id}:score <JSON>                         │
│              │  [no MinIO, no Kafka access — receives events via HTTP POST]            │
├──────────────┼─────────────────────────────────────────────────────────────────────────┤
│  leaderboard │  Redis:       ZRANGEBYSCORE leaderboard (SSE tick, every 1s)           │
│              │  Redis:       GET submission:{id}:score  (fast score detail)            │
│              │  TimescaleDB: SELECT metrics WHERE submission_id = $1 (chart queries)   │
│              │  TimescaleDB: SELECT DISTINCT ON metrics (leaderboard rebuild)          │
│              │  [no MinIO, no Kafka access]                                            │
└──────────────┴─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Data Flow Through Stores (End to End)

This shows exactly when each store is written or read as a submission moves through its full lifecycle.

```
Contestant uploads zip
        │
        ▼
[gateway] MinIO.putObject("submissions", "{id}/file.zip")
[gateway] TimescaleDB: INSERT INTO submissions (id, contestant_id, language, artifact_path, status='queued')
[gateway] Redis: SET submission:{id}:status "queued" EX 86400
[gateway] Redis: HSET submission:{id}:meta ...
        │
        ▼ (gateway calls sandbox via HTTP POST /sandbox/deploy)
[sandbox] MinIO.getObject("submissions", "{id}/file.zip") → /tmp/{id}/
[sandbox] Redis: SET submission:{id}:status "building" EX 86400
        │
        │  (docker build + container start)
        │
[sandbox] Redis:       SET submission:{id}:status "running" EX 86400
[sandbox] TimescaleDB: UPDATE submissions SET status='running', container_host=..., started_at=... WHERE id=...
[sandbox] Kafka:       PRODUCE submission.ready { submissionId, host, port }
[sandbox] MinIO:       removeObject (cleanup zip)
        │
        ▼
[bot-fleet] CONSUME submission.ready → spawn N worker threads
        │
        │  (bots fire orders at contestant exchange)
        │
[bot workers] HTTP POST telemetry service /events/batch every 50 events
        │
        ▼
[telemetry] HDR histogram records latency per submissionId
[telemetry] every 1000ms flush:
            TimescaleDB: INSERT INTO metrics (time, submission_id, p50, p90, p99, tps, ...)
            Redis: ZADD leaderboard <compositeScore> <submissionId>
            Redis: SET submission:{id}:score <JSON>
        │
        ▼
[leaderboard] every 1000ms:
              Redis: ZRANGEBYSCORE leaderboard -inf +inf WITHSCORES LIMIT 0 50
              SSE push to all connected browsers
        │
        ▼
[browser] live leaderboard updates

─── On admin stop ────────────────────────────────────────────────────────────
[gateway]   Redis: SET fleet:stop:{id} "1" EX 30
[gateway]   Kafka: PRODUCE submission.stopped { submissionId, reason:'manual_stop' }
[gateway]   TimescaleDB: UPDATE submissions SET status='stopped', stopped_at=... WHERE id=...
[bot-fleet] CONSUME submission.stopped → terminate all workers for submissionId
[sandbox]   CONSUME submission.stopped → docker.stop(container)
[telemetry] final flush → Redis: ZREM leaderboard <submissionId>
```

---

## 8. Migration Files

### `infra/migrations/001_init.sql` (already applied)

```sql
CREATE TABLE IF NOT EXISTS metrics (
  time             TIMESTAMPTZ NOT NULL,
  submission_id    TEXT        NOT NULL,
  latency_p50      FLOAT,
  latency_p90      FLOAT,
  latency_p99      FLOAT,
  tps              FLOAT,
  correctness_rate FLOAT,
  composite_score  FLOAT
);

SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_metrics_submission
  ON metrics (submission_id, time DESC);
```

### `infra/migrations/002_submissions_table.sql` (needs to be applied)

```sql
CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT        PRIMARY KEY,
  contestant_id   TEXT        NOT NULL,
  language        TEXT        NOT NULL CHECK (language IN ('cpp', 'rust', 'go')),
  artifact_path   TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','building','running','stopped','error')),
  container_host  TEXT,
  container_port  INTEGER,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_submissions_contestant
  ON submissions (contestant_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions (status);
```

### `infra/migrations/003_metrics_full.sql` (upgrade from 001)

Migration 001 created the metrics table without `total_orders`, `correct_fills`, `total_fills`, and made all metric columns nullable. This migration adds the missing columns and fixes nullability:

```sql
ALTER TABLE metrics
  ADD COLUMN IF NOT EXISTS total_orders  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_fills BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fills   BIGINT NOT NULL DEFAULT 0;

ALTER TABLE metrics
  ALTER COLUMN latency_p50      SET NOT NULL,
  ALTER COLUMN latency_p90      SET NOT NULL,
  ALTER COLUMN latency_p99      SET NOT NULL,
  ALTER COLUMN tps              SET NOT NULL,
  ALTER COLUMN correctness_rate SET NOT NULL,
  ALTER COLUMN composite_score  SET NOT NULL;

ALTER TABLE metrics
  ALTER COLUMN latency_p50      SET DEFAULT 0,
  ALTER COLUMN latency_p90      SET DEFAULT 0,
  ALTER COLUMN latency_p99      SET DEFAULT 0,
  ALTER COLUMN tps              SET DEFAULT 0,
  ALTER COLUMN correctness_rate SET DEFAULT 0,
  ALTER COLUMN composite_score  SET DEFAULT 0;
```

---

## Design Decisions — Rationale

| Decision | Why |
|---|---|
| `submissions` table in TimescaleDB, not only Redis | Redis is ephemeral in-memory. A restart loses all submission state. TimescaleDB survives restarts. Redis is the *cache*, TimescaleDB is the *source of truth*. |
| No FK constraint from `metrics` to `submissions` | TimescaleDB hypertables don't support FK constraints well under high write load. Application-layer consistency is sufficient here. |
| `total_orders`, `correct_fills`, `total_fills` in metrics | Allows computing correctness rate over any time window without scanning all raw telemetry events, which are never stored in the DB — only aggregated snapshots are. |
| `submission:{id}:score` JSON string in Redis | Leaderboard service needs both the sorted ranking (sorted set) AND the full score breakdown per submission. The sorted set only stores the composite float. The JSON string provides the breakdown without a TimescaleDB query on every SSE tick. |
| `fleet:stop:{id}` with 30s TTL | Bot workers poll this key. If the gateway crashes after setting it, the key self-expires and workers keep running (safe default). Manual stop is intentional, not permanent state. |
| MinIO cleanup after container start | Artifacts are needed only for the build step. Once the container is running, the binary is inside the container. Keeping the zip wastes storage over many submissions. |

---

*Database Design — IICPC Platform*
*Last updated: Phase 0 complete, Phase 1 pending*
