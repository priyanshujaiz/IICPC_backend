import { Router, Request, Response, IRouter } from 'express';
import { getLeaderboardPayload } from './snapshot.js';

const router: IRouter = Router();

// Track active SSE connections to enforce cap
let sseClientCount = 0;
const SSE_CLIENT_CAP = 100;

/**
 * GET /scores/stream — Server-Sent Events leaderboard stream.
 *
 * Pushes updated leaderboard JSON every 1 second.
 * CRITICAL: req.on('close') clears the interval to prevent memory leaks.
 * Rejects connections beyond SSE_CLIENT_CAP with 503.
 */
router.get('/scores/stream', (req: Request, res: Response) => {
  // Connection cap guard
  if (sseClientCount >= SSE_CLIENT_CAP) {
    res.status(503).json({ error: 'too many SSE clients — try again later' });
    return;
  }

  sseClientCount++;
  console.log(`[leaderboard:sse] client connected (total: ${sseClientCount})`);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders(); // send headers immediately so browser opens the stream

  // Send an initial comment to confirm connection
  res.write(': connected\n\n');

  // Push leaderboard every 1 second
  const interval = setInterval(async () => {
    try {
      if (res.writableEnded) return; // client already gone

      const payload = await getLeaderboardPayload();
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      console.error('[leaderboard:sse] push error:', (err as Error).message);
    }
  }, 1_000);

  // CRITICAL: clean up on disconnect — never skip this
  req.on('close', () => {
    clearInterval(interval);
    sseClientCount--;
    console.log(`[leaderboard:sse] client disconnected (total: ${sseClientCount})`);
  });
});

export { router as streamRouter };
