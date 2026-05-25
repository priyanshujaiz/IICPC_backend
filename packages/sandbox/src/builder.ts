import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import tar from 'tar-fs';
import { SandboxBuildError } from '@iicpc/shared';

// Talk directly to the Docker Engine over the mounted Unix socket.
// No Docker CLI binary needed inside the container.
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export type Language = 'cpp' | 'rust' | 'go';

/**
 * Detect language from files inside the extracted work directory.
 * Checks for presence of known files/extensions.
 */
export function detectLanguage(workDir: string): Language {
    const files = fs.readdirSync(workDir);

    const hasCargo = files.includes('Cargo.toml');
    const hasGoMod = files.includes('go.mod');
    const hasCpp = files.some((f) => f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.cxx'));

    if (hasCargo) return 'rust';
    if (hasGoMod) return 'go';
    if (hasCpp) return 'cpp';

    for (const entry of files) {
        const sub = path.join(workDir, entry);
        if (fs.statSync(sub).isDirectory()) {
            const subFiles = fs.readdirSync(sub);
            if (subFiles.includes('Cargo.toml')) return 'rust';
            if (subFiles.includes('go.mod')) return 'go';
            if (subFiles.some((f) => f.endsWith('.cpp') || f.endsWith('.cc'))) return 'cpp';
        }
    }
    throw new Error(`[sandbox] could not detect language in ${workDir}`);
}

export function generateDockerfile(language: Language): string {
    switch (language) {
        case 'cpp':
            return [
                '# Stage 1: Compile',
                'FROM gcc:12 AS builder',
                'WORKDIR /app',
                'COPY . .',
                'RUN find . -name "*.cpp" -o -name "*.cc" -o -name "*.cxx" | head -1 | xargs -I{} g++ -O2 -o exchange {}',
                '',
                '# Stage 2: Minimal runtime',
                'FROM debian:bookworm-slim',
                'WORKDIR /app',
                'COPY --from=builder /app/exchange /app/exchange',
                'EXPOSE 8080',
                'CMD ["/app/exchange"]',
            ].join('\n');
        case 'rust':
            return [
                '# Stage 1: Compile',
                'FROM rust:1.75-alpine AS builder',
                'RUN apk add --no-cache musl-dev',
                'WORKDIR /app',
                'COPY . .',
                'RUN cargo build --release',
                'RUN cp $(cargo metadata --no-deps --format-version 1 | python3 -c "import sys,json; print(json.load(sys.stdin)[\'packages\'][0][\'name\'])") ./exchange 2>/dev/null || mv target/release/$(ls target/release/ | grep -v \'.\' | head -1) ./exchange',
                '',
                '# Stage 2: Minimal runtime',
                'FROM alpine:3.19',
                'WORKDIR /app',
                'COPY --from=builder /app/exchange /app/exchange',
                'EXPOSE 8080',
                'CMD ["/app/exchange"]',
            ].join('\n');
        case 'go':
            return [
                '# Stage 1: Compile',
                'FROM golang:1.22-alpine AS builder',
                'WORKDIR /app',
                'COPY . .',
                'RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o exchange .',
                '',
                '# Stage 2: Minimal runtime (scratch = no OS)',
                'FROM scratch',
                'COPY --from=builder /app/exchange /exchange',
                'EXPOSE 8080',
                'CMD ["/exchange"]',
            ].join('\n');
    }
}

/**
 * Pre-pull all base images at sandbox startup.
 * Prevents the first submission from waiting 1–3 minutes for Docker Hub pulls.
 * Safe to call multiple times — skips images already in the local cache.
 */
export async function preWarmImages(): Promise<void> {
    const BASE_IMAGES = ['gcc:12', 'rust:1.75-alpine', 'golang:1.22-alpine', 'debian:bookworm-slim', 'alpine:3.19'];

    console.log('[sandbox] pre-warming base images...');

    for (const image of BASE_IMAGES) {
        try {
            const existing = await docker.listImages({ filters: { reference: [image] } });
            if (existing.length > 0) {
                console.log(`[sandbox] pre-warm: ${image} already cached ✓`);
                continue;
            }
            console.log(`[sandbox] pre-warm: pulling ${image}...`);
            const stream = await docker.pull(image);
            await new Promise<void>((resolve, reject) => {
                docker.modem.followProgress(
                    stream,
                    (err: Error | null) => err ? reject(err) : resolve(),
                    (event: { status?: string }) => {
                        if (event.status) process.stdout.write(`[docker-pull:${image}] ${event.status}\n`);
                    }
                );
            });
            console.log(`[sandbox] pre-warm: ${image} ready ✓`);
        } catch (err) {
            // Non-fatal: warn but continue — image will be pulled on first use
            console.warn(`[sandbox] pre-warm failed for ${image}:`, (err as Error).message);
        }
    }
    console.log('[sandbox] all base images ready');
}

/**
 * Builds a Docker image for the submission using the Dockerode API directly
 * over the mounted Unix socket — no docker CLI binary required inside the container.
 *
 * Steps:
 *  1. Write the Dockerfile into workDir
 *  2. Pack workDir as a tar stream (Docker Engine API expects tar, not a directory path)
 *  3. Stream the tar directly into docker.buildImage() over /var/run/docker.sock
 *  4. Follow the build progress stream and pipe output to console
 */
export async function buildImage(
    submissionId: string,
    workDir: string,
    language: Language,
): Promise<string> {
    try {
        const imageTag = `submission-${submissionId}:latest`;
        const dockerfilePath = path.join(workDir, 'Dockerfile');

        // ── Step 1: Write Dockerfile into the work directory ──────────────────
        fs.writeFileSync(dockerfilePath, generateDockerfile(language));
        console.log(`[sandbox] wrote Dockerfile to ${dockerfilePath}`);

        // ── Step 2: Pack the work directory into a tar stream ─────────────────
        // The Docker Engine API accepts tar archives, not bare directory paths.
        // tar-fs.pack() streams the directory without writing a temp .tar file.
        const packStream = tar.pack(workDir);

        console.log(`[sandbox] streaming build context to Docker Engine for ${imageTag}...`);

        // ── Step 3: Hand the tar stream to Dockerode ──────────────────────────
        // This goes over the unix socket — equivalent to `docker build` but
        // without needing the docker CLI binary installed.
        const buildStream = await docker.buildImage(packStream, {
            t: imageTag,
            forcerm: true,  // delete intermediate compilation layers on success or failure
        });

        // ── Step 4: Stream build output live to console ───────────────────────
        await new Promise<void>((resolve, reject) => {
            docker.modem.followProgress(
                buildStream,
                // Final callback — called once the stream ends
                (err: Error | null) => {
                    if (err) return reject(err);
                    resolve();
                },
                // Per-event callback — streams compiler output live
                (event: { stream?: string; error?: string }) => {
                    if (event.stream) {
                        process.stdout.write(`[docker-build] ${event.stream}`);
                    } else if (event.error) {
                        // Build errors (e.g. compile failure) come through as event.error
                        process.stderr.write(`[docker-build-error] ${event.error}\n`);
                        reject(new Error(event.error));
                    }
                },
            );
        });

        console.log(`[sandbox] image ${imageTag} built successfully via socket`);
        return imageTag;
    } catch (error) {
        console.error(`[sandbox] failed to build image for ${submissionId}:`, error);
        throw new SandboxBuildError(`Failed to build image for submission ${submissionId}`, error);
    }
}