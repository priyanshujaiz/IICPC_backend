import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { streamRouter } from './routes/stream.js';
import { snapshotRouter } from './routes/snapshot.js';
import { metricsRouter } from './routes/metrics.js';
import { statsRouter } from './routes/stats.js';

const app: Express = express();

// ── Security + CORS ───────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());           // allow all origins — frontend will be on a different port
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(healthRouter);
app.use(streamRouter);
app.use(snapshotRouter);
app.use(metricsRouter);
app.use(statsRouter);      // GET /stats — platform-wide aggregate KPIs

export { app };
