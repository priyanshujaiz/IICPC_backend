import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getEnv } from '@iicpc/shared';

const BUCKET = 'submissions';

export async function ensureInfrastructure(): Promise<void> {
  const s3 = new S3Client({
    endpoint: getEnv('MINIO_ENDPOINT'),
    region: 'us-east-1',
    credentials: {
      accessKeyId: getEnv('MINIO_ACCESS_KEY'),
      secretAccessKey: getEnv('MINIO_SECRET_KEY'),
    },
    forcePathStyle: true,
  });

  // Create the bucket if it doesn't exist — idempotent
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`[gateway] MinIO bucket "${BUCKET}" already exists`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`[gateway] MinIO bucket "${BUCKET}" created`);
  }
}
