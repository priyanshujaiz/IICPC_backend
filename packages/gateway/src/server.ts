
import { createApp } from './app';
import { getEnvNumber} from '@iicpc/shared';
import { ensureInfrastructure } from './setup';


const PORT=getEnvNumber('PORT',3000);

async function main() {
  // Ensure MinIO bucket exists before accepting any uploads
  await ensureInfrastructure();
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[gateway] listening on port ${PORT}`);
  });
}
main().catch((err) => {
  console.error('[gateway] startup failed:', err);
  process.exit(1);
});
