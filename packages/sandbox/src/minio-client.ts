import { S3Client, GetObjectCommand} from "@aws-sdk/client-s3"
import {getEnv} from "@iicpc/shared";
import fs from 'node:fs'
import fsp from 'node:fs/promises';
import unzipper from "unzipper";

import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';


const s3 = new S3Client({
  endpoint: getEnv('MINIO_ENDPOINT'),
  region: 'us-east-1',
  credentials: {
    accessKeyId: getEnv('MINIO_ACCESS_KEY'),
    secretAccessKey: getEnv('MINIO_SECRET_KEY'),
  },
  forcePathStyle: true,
});

const BUCKET = 'submissions';

/**
 * Downloads the submission artifact from MinIO into /tmp/iicpc/<submissionId>/
 * Returns the local directory path where the files were extracted.
 *
 * artifactPath is the MinIO key e.g. "a3f9b2c1-uuid/code.zip"
 */
export async function downloadArtifact(
  submissionId: string,
  artifactPath: string,
): Promise<string> {
  const workDir = path.join('/tmp', 'iicpc', submissionId);
  await fsp.mkdir(workDir, { recursive: true });

  const filename = path.basename(artifactPath);
  const localPath = path.join(workDir, filename);

  const response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: artifactPath }),
  );
  if (!response.Body) {
    throw new Error(`[sandbox] empty response body for artifact: ${artifactPath}`);
  }
  // Download to disk
  await pipeline(response.Body as Readable, fs.createWriteStream(localPath));
  console.log(`[sandbox] downloaded artifact to ${localPath}`);

  // ✅ Extract ZIP into workDir
  if (filename.endsWith('.zip')) {
    await pipeline(
      fs.createReadStream(localPath),
      unzipper.Extract({ path: workDir }),
    );
    await fsp.unlink(localPath); // remove the .zip after extraction
    console.log(`[sandbox] extracted zip to ${workDir}`);
  }

  return workDir; // return the directory, not the file — Docker needs the dir
}
/**
 * Removes the temp working directory after the container is built.
 * Call this after docker.buildImage() succeeds.
 */
export async function cleanupWorkDir(submissionId: string): Promise<void> {
  const workDir = path.join('/tmp', 'iicpc', submissionId);
  await fsp.rm(workDir, { recursive: true, force: true });
  console.log(`[sandbox] cleaned up ${workDir}`);
}
