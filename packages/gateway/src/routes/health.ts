import { Router } from 'express';

export const healthRouter:Router = Router();

// GET /health — used by k8s liveness probe and wait-for-infra.sh
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
