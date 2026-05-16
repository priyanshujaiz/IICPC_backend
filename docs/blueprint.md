IICPC SUMMER HACKATHON 2026
Distributed Benchmarking & Hosting Platform
Full System Architecture Blueprint
TypeScript + Node.js Stack
Hackathon Period: May 9 – June 10, 2026   |   Submissions Open: Final Week
 
1. Executive Summary
This document is the complete architectural blueprint for our submission to the IICPC Summer Hackathon 2026. Our goal is to build a production-grade Distributed Benchmarking and Hosting Platform that evaluates contestant-submitted trading infrastructure — specifically orderbooks and matching engines — under extreme concurrent load.

The platform operates as a full pipeline: contestants upload code, we containerize and deploy it in a secure sandbox, spawn thousands of distributed trading bots that bombard it with orders, capture granular latency and correctness telemetry, and stream live scores to a real-time leaderboard.

Core Engineering Mandate (from IICPC brief)
This is not a demo-to-win hackathon. We are expected to demonstrate: high-performance code, system resilience, deep understanding of distributed systems, and deliberate architectural reasoning behind every technical decision.

Component	Technology	Justification
API Gateway	Node.js + Express + TypeScript	I/O-bound routing; JWT auth; rate limiting
Sandbox Engine	Node.js + Dockerode + TypeScript	Docker SDK; container lifecycle management
Bot Fleet	Node.js + worker_threads + TypeScript	True parallelism via thread pool; Poisson arrivals
Telemetry Ingester	Fastify + TypeScript	Fastest Node.js HTTP server; HDR histogram
Leaderboard Service	Express + SSE + TypeScript	Server-Sent Events for real-time push
Frontend Dashboard	React + TypeScript + Recharts	Live SSE consumption; dynamic leaderboard
Message Bus	Redpanda (KafkaJS client)	Kafka-compatible; single binary; no ZooKeeper
Time-series Store	TimescaleDB (pg driver)	PostgreSQL extension; SQL; hypertables
Live State Store	Redis (ioredis)	Sorted sets for O(log N) leaderboard ranking
Submission Storage	MinIO (S3-compatible)	Local object store for uploaded artifacts
Orchestration	Docker Compose + k8s manifests	IaC deliverable; horizontal scaling proof

 
2. How the System Works — End to End
Before detailing each component, it is essential to understand the full data flow. Every step below is sequential and causal — nothing in the system fires without the step before it completing successfully.

2.1 The Complete Request Lifecycle
1.	Contestant uploads their compiled binary or source code (C++, Rust, Go) via the web dashboard.
2.	The API Gateway validates the JWT token, rate-limits the request, and hands the file to the Sandbox Engine via an internal REST call.
3.	The Sandbox Engine uses Dockerode to build a fresh Docker image from the submission, applies CPU pinning and memory caps, and starts the container on an isolated network.
4.	Once the container's health endpoint responds, the Sandbox Engine publishes a submission-ready event to Redpanda with the container's host and port.
5.	The Bot Fleet Orchestrator consumes this event and spawns N worker threads. Each worker runs an independent bot loop, sending Limit Orders, Market Orders, and Cancel requests to the contestant's exchange using Poisson-distributed arrival timing.
6.	After each order round-trip, each bot POSTs a telemetry event to the Telemetry Ingester: { sentAt, ackedAt, orderId, type, filled, expectedFill }.
7.	The Telemetry Ingester feeds these into an HDR Histogram per submission, computing p50/p90/p99 latency, TPS, and correctness. Every second it dual-writes: historical data to TimescaleDB and live scores to a Redis sorted set.
8.	The Leaderboard Service reads the Redis sorted set every second and pushes the updated rankings to all connected browser clients via Server-Sent Events (SSE).
9.	The React dashboard receives the SSE stream and updates the live leaderboard and latency charts in real time.

2.2 Inter-Service Communication Contracts
Each service boundary uses a clearly defined protocol. This decoupling is what the IICPC judges are looking for.

From	To	Protocol	Payload / Topic
Gateway	Sandbox Engine	HTTP REST (internal)	POST /sandbox/deploy { submissionId, imagePath }
Sandbox Engine	Redpanda	KafkaJS publish	Topic: submission-ready { submissionId, host, port }
Redpanda	Bot Fleet	KafkaJS consume	Topic: submission-ready
Bot (Worker thread)	Contestant Exchange	HTTP REST or WebSocket	Order messages (Limit / Market / Cancel)
Bot (Worker thread)	Telemetry Ingester	HTTP POST (Fastify)	POST /events { sentAt, ackedAt, ... }
Telemetry Ingester	TimescaleDB	pg driver (TCP)	INSERT INTO metrics (hypertable)
Telemetry Ingester	Redis	ioredis	ZADD leaderboard <score> <submissionId>
Leaderboard Service	Browser	SSE (text/event-stream)	data: JSON rankings every 1s
Sandbox Engine	Redis	ioredis	SET submission:{id}:status running/stopped

 
3. Monorepo Structure & Project Setup
We use a pnpm workspace monorepo. Every service is a separate package, shares the TypeScript types from packages/shared, and is independently deployable as a Docker container.

3.1 Folder Layout
iicpc/
  packages/
    gateway/          # Express — auth, file upload, routing
    sandbox/          # Dockerode — containerize submissions
    bot-fleet/        # worker_threads — concurrent bot simulation
    telemetry/        # Fastify — ingest metrics, compute histograms
    leaderboard/      # Express + SSE — scoring & streaming
    shared/           # Shared TS types, Kafka topics, constants
  frontend/           # React + TS — live dashboard
  infra/
    docker-compose.yml
    k8s/              # Kubernetes manifests per service
    terraform/        # Cloud provisioning (optional)
  docker/             # Dockerfiles per service
  scripts/            # Seed, stress test, teardown helpers
  pnpm-workspace.yaml
  turbo.json          # Turborepo build pipeline

3.2 shared/types.ts — The Contract Layer
Every service imports from @iicpc/shared. This is what makes the monorepo coherent. Changes to a type are immediately caught by TypeScript across all services.

// packages/shared/src/types.ts
export interface Submission {
  id: string;
  contestantId: string;
  status: 'queued' | 'building' | 'running' | 'stopped' | 'error';
  host?: string;
  port?: number;
  submittedAt: number;
}

export interface TelemetryEvent {
  submissionId: string;
  orderId: string;
  sentAt: number;        // monotonic ms timestamp from bot
  ackedAt: number;       // monotonic ms timestamp from ack
  orderType: 'LIMIT' | 'MARKET' | 'CANCEL';
  filled: number;        // actual fill quantity
  expectedFill: number;  // reference engine fill quantity
}

export interface LiveScore {
  submissionId: string;
  latencyP50: number;
  latencyP90: number;
  latencyP99: number;
  tps: number;
  correctnessRate: number;
  compositeScore: number;
}

 
4. Component Architecture — Deep Dives
4.1 API Gateway (packages/gateway)
Role
The single entry point for all external traffic. Handles authentication, rate limiting, file upload, and routes requests to downstream services. Does NOT do heavy computation.

Responsibilities
•	POST /submit — accept contestant code upload (multer, multipart/form-data)
•	POST /auth/login — issue signed JWT (jsonwebtoken, 1-hour expiry)
•	GET /runs/:id — return submission status from Redis
•	GET /health — liveness probe for k8s
•	Middleware chain: helmet (security headers) → express-rate-limit (100 req/min per IP) → JWT verify → zod body validation

Critical Design Decisions
•	Rate limiting is applied before auth to prevent brute force on the auth endpoint itself.
•	File uploads are streamed to MinIO (S3-compatible object store) and never written to local disk. This ensures the gateway is stateless and horizontally scalable.
•	The gateway does NOT build or run containers. It hands off submissionId and the MinIO object path to the Sandbox Engine and returns immediately with a 202 Accepted.

Key Dependencies
Package	Purpose
express	HTTP server framework
multer	Multipart file upload parsing
multer-s3	Stream uploads directly to MinIO/S3
jsonwebtoken	JWT sign and verify
express-rate-limit	Rate limiting middleware
helmet	Security headers
zod	Runtime request body validation
@iicpc/shared	Shared TypeScript types

4.2 Sandbox Engine (packages/sandbox)
Role
The most security-critical service. Takes a contestant submission, builds it in a disposable container, runs it in strict isolation, and advertises its endpoint to the rest of the platform via Redpanda.

Container Isolation Strategy
This is what separates a serious platform from a demo. Every isolation measure must be explicitly set — Docker does not apply them by default.

const container = await docker.createContainer({
  Image: `submission-${submissionId}:latest`,
  HostConfig: {
    Memory: 536870912,          // 512 MB hard cap
    CpusetCpus: '2,3',          // pinned to cores 2 and 3
    NanoCpus: 1000000000,       // 1 CPU max
    ReadonlyRootfs: true,        // immutable filesystem
    CapDrop: ['ALL'],            // drop all Linux capabilities
    SecurityOpt: ['no-new-privileges'],
    NetworkMode: 'sandbox-net', // isolated bridge network
    PidsLimit: 100,             // prevent fork bombs
    Ulimits: [{ Name: 'nofile', Soft: 256, Hard: 256 }],
  },
  ExposedPorts: { '8080/tcp': {} },
});

Build Pipeline (step by step)
10.	Download submission artifact from MinIO into a temp directory.
11.	Detect language (C++/Rust/Go) by file extension or manifest.
12.	Start a disposable builder container (e.g., gcc:12) with the source mounted read-only.
13.	Execute compiler inside builder, copy output binary out, destroy builder container.
14.	Build a minimal runtime image (FROM scratch or alpine) containing only the binary.
15.	Create and start the runtime container with the isolation config above.
16.	Poll the container's /health endpoint (max 30s) until it responds 200.
17.	Publish submission-ready event to Redpanda with { submissionId, host, port }.
18.	Write submission status to Redis: SET submission:{id}:status running.

Key Dependencies
Package	Purpose
dockerode	Node.js Docker API client
kafkajs	Redpanda/Kafka producer
ioredis	Redis client for status updates
minio	MinIO client to download submission artifacts
uuid	Generate unique submission IDs
@iicpc/shared	Shared types and Kafka topic constants

4.3 Bot Fleet Orchestrator (packages/bot-fleet)
Role
The engine of the platform. Consumes submission-ready events, spawns a pool of worker threads (each running an independent bot), and drives concurrent load at the contestant's exchange using realistic market microstructure timing.

Why worker_threads (not async/await)?
Standard Node.js async/await is excellent for I/O concurrency but all callbacks still run on a single event loop thread. Generating thousands of simultaneous bots with tight timing requires true CPU-level parallelism. Node.js worker_threads give each bot its own V8 isolate and event loop, with shared memory communication via SharedArrayBuffer where needed.

Orchestrator (main thread)
// Consumes submission-ready from Redpanda
// Manages worker pool lifecycle
const orchestrator = {
  async onSubmissionReady(event: SubmissionReadyEvent) {
    const workers: Worker[] = [];
    for (let i = 0; i < BOT_COUNT; i++) {
      const w = new Worker('./bot-worker.js', {
        workerData: {
          submissionId: event.submissionId,
          targetHost: event.host,
          targetPort: event.port,
          botId: i,
          scenarioConfig: loadScenario('default'),
        }
      });
      w.on('message', handleTelemetry);
      w.on('error', handleWorkerError);
      workers.push(w);
    }
  }
};

Bot Worker (worker thread)
Each worker simulates one market participant. The key engineering choice is Poisson-distributed arrival timing. Real markets have bursty, unpredictable order flow — a uniform rate (e.g., 10 orders/sec exactly) is unrealistic and easy to game.

// Poisson inter-arrival time: -ln(U) / lambda
// lambda = target orders per second (e.g., 100)
function poissonDelay(lambda: number): number {
  return -Math.log(Math.random()) / lambda * 1000; // ms
}

async function botLoop(config: BotConfig) {
  while (running) {
    const delay = poissonDelay(config.lambda);
    await sleep(delay);
    
    const order = generateOrder(config); // LIMIT/MARKET/CANCEL
    const sentAt = performance.now();
    const response = await sendOrder(config.target, order);
    const ackedAt = performance.now();
    
    parentPort!.postMessage({
      type: 'telemetry',
      payload: { sentAt, ackedAt, orderId: order.id, ... }
    });
  }
}

Order Mix Configuration
Order Type	Proportion	Purpose
Limit Order (Buy/Sell)	60%	Tests orderbook insertion, price-time priority
Market Order	25%	Tests matching engine correctness and fill accuracy
Cancel Order	15%	Tests order lifecycle management and queue removal

4.4 Telemetry Ingester (packages/telemetry)
Role
Receives raw timing events from every bot, computes statistically accurate latency percentiles using HDR Histograms, validates fill correctness, and streams computed metrics to TimescaleDB and Redis.

Why Fastify instead of Express?
This is the hottest path in the system — potentially thousands of POST /events per second during peak load. Fastify is measurably faster than Express (benchmarks show 30-50% higher throughput) because it uses a radix tree router and schema-based JSON serialization. For a telemetry ingester, this matters.

HDR Histogram for Accurate Percentiles
A naive approach to computing p99 latency would be to store all latency values in an array and sort them. This is O(N log N) and uses unbounded memory. HDR Histogram (hdr-histogram-js) uses a fixed-size bucketed counter structure that computes p50/p90/p99 in O(1) time and O(1) memory, which is exactly what production monitoring systems like HdrHistogram.org and LMAX Disruptor use.

import { build } from 'hdr-histogram-js';

const histograms = new Map<string, ReturnType<typeof build>>();

function getOrCreateHistogram(submissionId: string) {
  if (!histograms.has(submissionId)) {
    histograms.set(submissionId, build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: 60000, // 60s max
      numberOfSignificantValueDigits: 3,
    }));
  }
  return histograms.get(submissionId)!;
}

// On each telemetry event:
const latencyMs = event.ackedAt - event.sentAt;
const hist = getOrCreateHistogram(event.submissionId);
hist.recordValue(latencyMs);

// Every 1000ms flush to stores:
const snapshot = {
  p50: hist.getValueAtPercentile(50),
  p90: hist.getValueAtPercentile(90),
  p99: hist.getValueAtPercentile(99),
  tps: eventCount / 1,  // events in last second
};

Correctness Validation
For each market order, we run the same order through a reference matching engine (our own implementation) and compare the fill result. A fill is correct if: the fill quantity matches, the fill price respects price-time priority, and no phantom fills occur.

•	correctnessRate = (correctFills / totalMarketOrders) * 100
•	Any violation is logged with orderId, expected fill, and actual fill for the Architecture Blueprint.
•	Reference engine runs synchronously in the telemetry service — it is a simple TypeScript class, not a separate container.

Dual Write Strategy
Destination	What is written	Why
TimescaleDB	Full metric row per second per submission (p50/p90/p99/TPS/correctness/timestamp)	Historical analysis, graph rendering, audit trail for judges
Redis ZADD	Composite score per submission (single float)	O(log N) sorted set; leaderboard reads in O(N) — very fast

4.5 Leaderboard Service (packages/leaderboard)
Role
Reads live scores from Redis and pushes them to all connected browser clients via Server-Sent Events (SSE). Also serves historical chart data from TimescaleDB on demand.

Scoring Formula
The composite score is a weighted combination of the three IICPC-mandated dimensions: speed (latency), stability (throughput), and algorithmic accuracy (correctness).

// Scores are normalized 0-100 within the current round
// Lower p99 latency = higher latencyScore
// Higher TPS = higher throughputScore
// Higher fill correctness rate = higher correctnessScore

function compositeScore(metrics: LiveScore): number {
  const latencyScore    = normalize(1 / metrics.latencyP99, allLatencies);
  const throughputScore = normalize(metrics.tps, allTps);
  const correctScore    = metrics.correctnessRate; // already 0-100
  return (0.40 * latencyScore) + (0.40 * throughputScore) + (0.20 * correctScore);
}

SSE Streaming Implementation
// GET /scores/stream
app.get('/scores/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const interval = setInterval(async () => {
    const rankings = await redis.zrangebyscore(
      'leaderboard', '-inf', '+inf', 'WITHSCORES', 'LIMIT', '0', '50'
    );
    const payload = formatRankings(rankings);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

 
5. Data Store Architecture
5.1 TimescaleDB — Historical Metrics
TimescaleDB is a PostgreSQL extension that adds automatic time-series partitioning (called hypertables). We use it because our judges expect to see real query capability over historical data, and TimescaleDB lets us use standard SQL — no new query language to learn.

Schema
-- Hypertable: automatically partitioned by time
CREATE TABLE metrics (
  time            TIMESTAMPTZ NOT NULL,
  submission_id   TEXT        NOT NULL,
  latency_p50     FLOAT,
  latency_p90     FLOAT,
  latency_p99     FLOAT,
  tps             FLOAT,
  correctness_rate FLOAT,
  composite_score  FLOAT
);

SELECT create_hypertable('metrics', 'time');

-- Index for fast per-submission queries
CREATE INDEX ON metrics (submission_id, time DESC);

5.2 Redis — Live Leaderboard State
Redis sorted sets (ZADD/ZRANGEBYSCORE) are the perfect data structure for a leaderboard. Insertion and retrieval are both O(log N). We also use Redis for submission status caching and bot fleet coordination signals.

Key Pattern	Type	Contents
leaderboard	Sorted Set	member=submissionId, score=compositeScore
submission:{id}:status	String	queued | building | running | stopped | error
submission:{id}:meta	Hash	contestantId, submittedAt, language
fleet:stop:{submissionId}	String (TTL)	Signal for bots to stop (publish then expire)

5.3 Redpanda — Event Bus
Redpanda is a Kafka-compatible streaming platform delivered as a single binary with no ZooKeeper dependency. This is ideal for a hackathon — we get full Kafka semantics (topics, consumer groups, offset management) without the operational complexity of a full Kafka cluster.

Topic	Producer	Consumer	Purpose
submission-ready	Sandbox Engine	Bot Fleet	Signals that a container is live and ready to receive load
submission-stopped	Gateway / Admin	Bot Fleet	Signals bots to drain and stop for a given submission
telemetry-events	Bot Fleet (optional)	Telemetry Ingester	Alternative async path for very high event volumes

 
6. Frontend Dashboard (React + TypeScript)
The frontend is a real judged deliverable — it must demonstrate live metric streaming, not just a static result page. We build it with React, TypeScript, and Recharts, consuming the SSE stream from the Leaderboard Service.

6.1 Key Pages
Page	Components	Data Source
Leaderboard (live)	RankingTable, LiveBadge, ScoreTrend sparkline	SSE /scores/stream
Submission Detail	LatencyChart (p50/p90/p99 over time), TPS gauge, CorrectnessBar	GET /metrics/:submissionId (TimescaleDB)
Submit Code	FileDropzone, LanguageSelector, ProgressTracker	POST /submit (Gateway)
Admin Panel	StopRun button, ContainerStatus, BotCount slider	GET/POST /admin/* (Gateway)

6.2 SSE Consumer Pattern
// src/hooks/useLeaderboard.ts
export function useLeaderboard() {
  const [rankings, setRankings] = useState<LiveScore[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/scores/stream');
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as LiveScore[];
      setRankings(data.sort((a, b) => b.compositeScore - a.compositeScore));
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, []);

  return rankings;
}

 
7. Infrastructure as Code (IaC)
The IICPC brief explicitly requires IaC as a deliverable: automated deployment scripts proving the platform can be spun up, configured, and scaled horizontally. We deliver two levels: Docker Compose for local development and Kubernetes manifests for production-grade deployment.

7.1 Docker Compose (Local / Demo)
A single docker compose up starts all services, Redpanda, TimescaleDB, Redis, and MinIO. This is what we run for the demo.
services:
  gateway:
    build: ./docker/gateway
    ports: ['3000:3000']
    environment:
      - REDIS_URL=redis://redis:6379
      - KAFKA_BROKERS=redpanda:9092
      - MINIO_ENDPOINT=minio:9000

  sandbox:
    build: ./docker/sandbox
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # DinD
    environment:
      - KAFKA_BROKERS=redpanda:9092

  bot-fleet:
    build: ./docker/bot-fleet
    environment:
      - KAFKA_BROKERS=redpanda:9092
      - TELEMETRY_URL=http://telemetry:4000
      - BOT_COUNT=200

  telemetry:
    build: ./docker/telemetry
    ports: ['4000:4000']

  leaderboard:
    build: ./docker/leaderboard
    ports: ['4001:4001']

  redpanda:
    image: redpandadata/redpanda:latest
    command: redpanda start --overprovisioned --smp 1 --memory 1G

  timescaledb:
    image: timescale/timescaledb:latest-pg15

  redis:
    image: redis:7-alpine

  minio:
    image: minio/minio
    command: server /data

7.2 Kubernetes Manifests (Horizontal Scaling Proof)
For the IaC deliverable, we provide k8s manifests demonstrating horizontal scaling. The bot-fleet and telemetry services are the ones that scale horizontally under load.
# infra/k8s/bot-fleet-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bot-fleet
spec:
  replicas: 3           # Scale this to increase bot count
  selector:
    matchLabels:
      app: bot-fleet
  template:
    spec:
      containers:
      - name: bot-fleet
        image: iicpc/bot-fleet:latest
        resources:
          requests: { cpu: '500m', memory: '512Mi' }
          limits:   { cpu: '2000m', memory: '2Gi' }
        env:
        - name: BOT_COUNT
          value: '500'   # bots per pod replica

 
8. Build Phases — Sequential Execution Plan
The hackathon runs May 9 to June 10 (approximately 4.5 weeks). Below is the exact build order. Each phase is a vertical slice — at the end of each phase the platform has more working capability, not just more code.

PHASE 1
Foundation & Sandbox Pipeline
Week 1 — May 9 to May 16

Goal: A contestant can upload code and it runs in a container.

Step 1.1 — Monorepo setup
•	Initialize pnpm workspace with packages/gateway, packages/sandbox, packages/shared
•	Configure tsconfig.json with strict mode and path aliases for @iicpc/shared
•	Set up Turborepo (turbo.json) for parallel builds
•	Add ESLint + Prettier with shared config in packages/shared

Step 1.2 — Shared types
•	Define Submission, TelemetryEvent, LiveScore, SubmissionReadyEvent interfaces in packages/shared/src/types.ts
•	Define Kafka topic name constants: TOPICS.SUBMISSION_READY, TOPICS.SUBMISSION_STOPPED
•	Export KafkaJS producer/consumer factory helpers

Step 1.3 — Docker Compose infrastructure
•	Write docker-compose.yml with Redpanda, Redis, TimescaleDB, MinIO
•	Write docker/gateway/Dockerfile (Node 20 alpine, non-root user)
•	Write docker/sandbox/Dockerfile — must mount Docker socket for DinD
•	Verify all infrastructure containers start with docker compose up

Step 1.4 — Gateway: upload endpoint
•	Express app with JWT middleware (jsonwebtoken + express-rate-limit + helmet)
•	POST /submit using multer-s3 to stream directly to MinIO
•	Return { submissionId } on 202 Accepted
•	GET /runs/:id reads status from Redis

Step 1.5 — Sandbox: container pipeline
•	KafkaJS consumer listening on submission-ready
•	Download artifact from MinIO using minio client
•	Detect language from file extension
•	Build Docker image with Dockerode (docker.buildImage)
•	Create and start container with all isolation flags (see Section 4.2)
•	Poll /health endpoint, then publish submission-ready to Redpanda

Phase 1 Done When...
You can POST a .zip file to the gateway, watch the sandbox build and start a container, and see submission:{id}:status = running in Redis.

PHASE 2
Bot Fleet & Raw Telemetry
Week 2 — May 17 to May 23

Goal: Bots are sending orders and raw latency numbers appear in the console.

Step 2.1 — Bot Fleet scaffolding
•	Create packages/bot-fleet with a main orchestrator (src/orchestrator.ts)
•	KafkaJS consumer subscribing to submission-ready topic
•	Worker thread management: spawn N workers, handle worker errors, restart dead workers

Step 2.2 — Bot Worker implementation
•	bot-worker.ts: receive workerData (submissionId, host, port, botId, scenarioConfig)
•	Implement botLoop with Poisson inter-arrival timing (see Section 4.3)
•	Implement generateOrder() — random Limit/Market/Cancel with realistic price levels
•	Send orders via axios (HTTP) or ws (WebSocket) depending on exchange interface
•	Record sentAt = performance.now() before send, ackedAt after response
•	Post telemetry via parentPort.postMessage

Step 2.3 — Telemetry Ingester: basic ingestion
•	Create packages/telemetry with Fastify server
•	POST /events endpoint: parse body, validate with zod
•	Feed into HDR Histogram per submissionId
•	Every 1000ms log p50/p90/p99 and TPS to console (database write comes in Phase 3)

Step 2.4 — Write a reference exchange for testing
•	Create a minimal TypeScript orderbook in scripts/ref-exchange/ (Express, in-memory)
•	This is your test target during development — not a contestant submission
•	It must expose the same HTTP interface you will document for contestants

Phase 2 Done When...
You can run the platform against your reference exchange and see latency percentiles being printed every second in the telemetry service console.

PHASE 3
Persistence, Scoring & Live Leaderboard
Week 3 — May 24 to May 30

Goal: Metrics are persisted, scores are computed, and the SSE endpoint is live.

Step 3.1 — TimescaleDB integration
•	Run migration: CREATE TABLE metrics + create_hypertable in infra/migrations/001_init.sql
•	In telemetry service: add pg pool (node-postgres), INSERT metrics row every flush cycle
•	Verify rows appear in TimescaleDB with psql

Step 3.2 — Redis sorted set for live scores
•	In telemetry service: compute compositeScore every flush (see Section 4.5)
•	ZADD leaderboard <compositeScore> <submissionId> via ioredis
•	Verify with redis-cli: ZRANGEBYSCORE leaderboard -inf +inf WITHSCORES

Step 3.3 — Correctness validation
•	Implement ReferenceMatchingEngine class in packages/telemetry/src/reference-engine.ts
•	For each MARKET order event: replay through reference engine, compare fills
•	Increment correctFills or incorrectFills counters, compute correctnessRate
•	Include in flush payload to both TimescaleDB and Redis

Step 3.4 — Leaderboard Service
•	Create packages/leaderboard with Express
•	GET /scores/stream — SSE implementation (see Section 4.5)
•	GET /metrics/:submissionId — TimescaleDB query returning last 5 minutes of data
•	Handle client disconnect with clearInterval to prevent memory leaks

Phase 3 Done When...
curl -N http://localhost:4001/scores/stream returns live JSON data updates every second with real composite scores.

PHASE 4
React Dashboard & Full Integration
Week 4 — May 31 to June 6

Goal: The complete platform works end-to-end with a polished frontend.

Step 4.1 — React project setup
•	Create frontend/ with Vite + React + TypeScript template
•	Install recharts, react-query, and axios
•	Configure Vite proxy: /api/* → http://localhost:3000 (gateway)

Step 4.2 — Leaderboard page
•	Implement useLeaderboard() hook (SSE consumer, see Section 6.2)
•	RankingTable component: rank, submissionId, p99 latency, TPS, correctness, score
•	Auto-sort by compositeScore descending on every SSE update
•	Highlight rows that move position with a brief CSS transition

Step 4.3 — Submission detail page
•	useMetrics(submissionId) hook: react-query polling GET /metrics/:id every 5s
•	Recharts LineChart showing p50/p90/p99 latency over time
•	Recharts AreaChart showing TPS over time
•	Correctness rate displayed as a progress bar with pass/fail count

Step 4.4 — Submit page
•	File drop zone (react-dropzone) accepting .zip, .tar.gz
•	Language selector (C++, Rust, Go)
•	Progress tracker: Uploading → Building → Running → Live
•	Poll GET /runs/:id every 2s to drive progress state

Step 4.5 — Full end-to-end test
•	Submit a C++ or Rust orderbook (use an open-source sample)
•	Watch it progress through the pipeline on the Submit page
•	Confirm it appears on the Leaderboard within 60 seconds of going live
•	Confirm latency charts populate correctly

Phase 4 Done When...
A full demo run works: upload → container live → bots firing → live leaderboard updating — all visible in the browser without touching the terminal.

PHASE 5
Hardening, IaC & Architecture Blueprint
Final Week — June 7 to June 10

Goal: Production-readiness, k8s manifests, and the judged deliverables polished.

Step 5.1 — Kubernetes manifests
•	Write k8s Deployment YAML for each service (gateway, sandbox, bot-fleet, telemetry, leaderboard)
•	Write k8s Service YAML for internal discovery
•	Write HorizontalPodAutoscaler for bot-fleet (scale on CPU utilization)
•	Write Helm chart or Kustomize overlay as the top-level IaC entry point

Step 5.2 — Resilience hardening
•	Add dead-letter handling for Kafka consumer errors (log, skip, continue — never crash)
•	Add container watchdog in sandbox: if container exits unexpectedly, update Redis status and re-publish stopped event
•	Add SSE reconnection logic in frontend (EventSource auto-reconnects, ensure server handles it cleanly)
•	Add graceful shutdown to all services (SIGTERM handler, drain in-flight requests)

Step 5.3 — Architecture Blueprint document
•	Document every microservice: purpose, API surface, environment variables
•	Document all Kafka topics with schema
•	Document isolation strategy with exact Dockerode flags
•	Document scoring formula with weights and normalization approach
•	Include this document as the primary submission artifact

Step 5.4 — Demo preparation
•	Record a 5-minute walkthrough: upload → pipeline → live leaderboard
•	Prepare a one-page architecture diagram for verbal explanation
•	Have docker compose up ready to run in under 2 minutes from cold start

Phase 5 Done When...
docker compose up starts the entire platform in under 2 minutes. kubectl apply -f infra/k8s/ deploys to a cluster. The Architecture Blueprint document is complete and attached to the submission.

 
9. IICPC Requirements Coverage Matrix
Every requirement from the official IICPC brief is mapped to a specific technical implementation in our platform.

IICPC Requirement	Our Implementation	Location
Secure code upload pipeline	JWT auth + rate limiting + MinIO streaming upload (no local disk write)	Gateway service
Containerize submissions in isolated environments	Dockerode with CapDrop ALL, ReadonlyRootfs, CPU pinning, PidsLimit, isolated network	Sandbox service
Strict CPU and memory limits	HostConfig.Memory 512MB, HostConfig.CpusetCpus, HostConfig.NanoCpus	Sandbox service
Scalable bot fleet spawning thousands of bots	worker_threads pool per submission, Poisson arrivals, horizontally scaled via k8s	Bot Fleet service
Simulate diverse market participants	60% Limit / 25% Market / 15% Cancel with random price levels	Bot Worker
FIX, REST, or WebSocket order submission	HTTP REST + WebSocket support in bot worker (contestant chooses protocol)	Bot Worker
p50, p90, p99 latency measurement	HDR Histogram per submission, computed every flush cycle	Telemetry Ingester
Maximum TPS before failure	Event counter per second, recorded alongside latency in TimescaleDB	Telemetry Ingester
Price-time priority correctness validation	Reference matching engine comparison per market order	Telemetry Ingester
Real-time leaderboard with live metrics	SSE stream pushing composite scores from Redis every 1s	Leaderboard + Frontend
Dynamic ranking by speed, stability, accuracy	Composite score: 40% latency + 40% TPS + 20% correctness	Leaderboard Service
Architecture Blueprint document	This document, plus inline code comments and API docs	Deliverable
Infrastructure as Code	Docker Compose (demo) + Kubernetes manifests + Helm chart (production)	infra/ directory
Horizontal scalability proof	bot-fleet HorizontalPodAutoscaler, telemetry replica scaling in k8s	k8s manifests

 
10. Technical Risks & Mitigations
Risk	Severity	Mitigation
Docker-in-Docker (DinD) socket access in sandbox	High	Mount /var/run/docker.sock in compose; use dedicated sandbox network; document security tradeoff in blueprint
Clock skew between bot and exchange for latency measurement	High	Use performance.now() (monotonic) on the bot side only; measure round-trip from bot's perspective exclusively
Node.js worker threads memory pressure at scale	Medium	Cap BOT_COUNT per pod; use k8s HPA to add pods rather than threads per pod; set --max-old-space-size
Contestant code attempting network calls outside sandbox	High	sandbox-net has no external routing; iptables rules block outbound; container has no DNS for external hosts
Redpanda single-node failure in demo	Medium	Run Redpanda with a volume mount; add --check-rpk-version=false for stability; document HA option for judges
TimescaleDB write bottleneck under high telemetry volume	Medium	Batch INSERT (100 rows per statement); use connection pooling via pg-pool; tune shared_buffers
SSE backpressure if leaderboard clients are slow	Low	Check res.writableEnded before each write; use drain event handling; cap connected clients at 100

 
11. Glossary of Key Terms
Term	Definition
HDR Histogram	High Dynamic Range Histogram — a fixed-memory data structure for computing latency percentiles in O(1) time
p99 latency	The 99th percentile latency — 99% of requests were faster than this value
Poisson arrival process	A statistical model of random events where the time between events follows an exponential distribution — models real market order flow
SSE (Server-Sent Events)	An HTTP standard for server-to-client push: the server keeps a connection open and streams text/event-stream data
Redpanda	A Kafka-compatible streaming platform delivered as a single binary — no ZooKeeper required
Hypertable	A TimescaleDB abstraction that automatically partitions a time-series table by time intervals for fast queries
DinD (Docker-in-Docker)	Running Docker commands from inside a Docker container by mounting the host Docker socket
Price-time priority	The standard matching rule: orders at the same price are filled in the order they arrived
Composite score	Our weighted scoring formula: 40% latency score + 40% throughput score + 20% correctness score
Worker thread	A Node.js construct that runs a JavaScript module in a separate OS thread with its own V8 isolate and event loop
HPA (HorizontalPodAutoscaler)	A Kubernetes controller that automatically scales deployment replicas based on CPU or custom metrics

End of Architecture Blueprint
IICPC Summer Hackathon 2026  |  May 9 – June 10, 2026
