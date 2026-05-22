import { Router } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';
import Redis from 'ioredis';
import { getEnv } from '@iicpc/shared';
import { requireAuth } from '../middleware/auth.js';

export const submitRouter:Router = Router();
const redis = new Redis(getEnv('REDIS_URL'));

// MinIO S3 client — uses same AWS SDK interface
const s3 = new S3Client({
  endpoint: getEnv('MINIO_ENDPOINT'),
  region: 'us-east-1',            // MinIO ignores this but SDK requires it
  credentials: {
    accessKeyId: getEnv('MINIO_ACCESS_KEY'),
    secretAccessKey: getEnv('MINIO_SECRET_KEY'),
  },
  forcePathStyle: true,           // required for MinIO — disables virtual hosting
});

const BUCKET = 'submissions';

// multer-s3 storage: pipes upload stream directly to MinIO, never touches disk
const storage = multerS3({
  s3,
  bucket: BUCKET,
  key: (_req, file, cb) => {
    const submissionId = uuid();
    // store submissionId on request so the handler can read it
    (_req as any).submissionId = submissionId;
    cb(null, `${submissionId}/${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['.zip', '.tar', '.gz'];
    const ok = allowed.some((ext) => file.originalname.endsWith(ext));
    cb(null, ok);
  },
});

// POST /submit
// Header: Authorization: Bearer <token>
// Body: multipart/form-data  field: file (zip/tar.gz)
submitRouter.post('/', requireAuth, upload.single('file'), async (req, res) => {
  const submissionId: string = (req as any).submissionId;
  const artifactPath = (req.file as Express.MulterS3.File).key;
  const contestantId = req.user!.sub;

  // Write initial status and metadata to Redis
  await redis.set(`submission:${submissionId}:status`, 'queued');
  await redis.hset(`submission:${submissionId}:meta`, {
    contestantId,
    artifactPath,
    submittedAt: Date.now().toString(),
    language: req.body.language ?? 'unknown',
  });

  // ── Trigger the sandbox pipeline ───────────────────────────────────────────
  // Fire-and-forget: gateway returns 202 immediately.
  // If sandbox is temporarily down, submission stays 'queued' in Redis and the
  // error is logged. Client can poll GET /runs/:id to track status.
  const sandboxUrl = getEnv('SANDBOX_URL');
  fetch(`${sandboxUrl}/sandbox/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submissionId, artifactPath }),
  }).catch((err: Error) => {
    console.error('[gateway] failed to trigger sandbox for', submissionId, ':', err.message);
  });

  res.status(202).json({ submissionId });
});

