import { Router, IRouter } from 'express';

const router: IRouter = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), service: 'leaderboard' });
});

export { router as healthRouter };
