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
                'FROM gcc:12',
                'WORKDIR /app',
                'COPY . .',
                '# Find and compile the first .cpp file found',
                'RUN find . -name "*.cpp" | head -1 | xargs -I{} g++ -O2 -o exchange {}',
                'EXPOSE 8080',
                'CMD ["./exchange"]',
            ].join('\n');
        case 'rust':
            return [
                'FROM rust:1.75-alpine',
                'RUN apk add --no-cache musl-dev',
                'WORKDIR /app',
                'COPY . .',
                'RUN cargo build --release',
                'RUN cp target/release/$(cargo metadata --no-deps --format-version 1 | python3 -c "import sys,json; print(json.load(sys.stdin)[\'packages\'][0][\'name\'])") ./exchange 2>/dev/null || cp target/release/* ./exchange',
                'EXPOSE 8080',
                'CMD ["./exchange"]',
            ].join('\n');
        case 'go':
            return [
                'FROM golang:1.22-alpine',
                'WORKDIR /app',
                'COPY . .',
                'RUN go build -o exchange .',
                'EXPOSE 8080',
                'CMD ["./exchange"]',
            ].join('\n');
    }
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