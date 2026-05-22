import axios from 'axios';
import { ContainerTimeoutError } from '@iicpc/shared';

const POLL_INTERVAL_MS = 2_000;  // 2 seconds between attempts
const TIMEOUT_MS = 30_000;       // 30 seconds total before giving up

/**
 * Polls GET http://{host}:{port}/health every 2s until it returns HTTP 200.
 * Throws ContainerTimeoutError if the container doesn't become healthy in 30s.
 */
export async function waitForHealthy(
  submissionId: string,
  host: string,
  port: number,
): Promise<void> {
  const url = `http://${host}:${port}/health`;
  const deadline = Date.now() + TIMEOUT_MS;

  console.log(`[sandbox] polling ${url} for submission ${submissionId}`);

  while (Date.now() < deadline) {
    try {
      const res = await axios.get(url, { timeout: 1_500 });
      if (res.status === 200) {
        console.log(`[sandbox] container healthy for submission ${submissionId}`);
        return; // success — container is ready
      }
    } catch {
      // Not ready yet — swallow error and retry after interval
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Deadline exceeded
  throw new ContainerTimeoutError(
    `Container for submission ${submissionId} did not become healthy within ${TIMEOUT_MS / 1000}s`,
    submissionId,
  );
}
