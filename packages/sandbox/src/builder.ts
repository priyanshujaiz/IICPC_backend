import { spawn } from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { SandboxBuildError } from '@iicpc/shared';



export type Language = 'cpp' | 'rust' | 'go';

/**
 * Detect language from files inside the extracted work directory.
 * Checks for presence of known files/extensions.
 */


export function detectLanguage(workDir:string):Language{
    const files= fs.readdirSync(workDir);

    const hasCargo=files.includes('Cargo.toml');
    const hasGoMod=files.includes('go.mod');
    const hasCpp= files.some((f)=>f.endsWith('.cpp')||f.endsWith('.cc') || f.endsWith('.cxx'));

    if(hasCargo) return 'rust';
    if(hasGoMod) return 'go';
    if(hasCpp) return 'cpp';

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


export async function buildImage(
    submissionId:string,
    workDir:string,
    language:Language,
):Promise<string>{
    try{
        const imageTag=`submission-${submissionId}:latest`;
        const dockerfilePath=path.join(workDir,'Dockerfile');

        //Write DockerFile into temp file
        fs.writeFileSync(dockerfilePath,generateDockerfile(language));

        console.log(`[sandbox] wrote Dockerfile to ${dockerfilePath}`);

        // Run docker build — output is streamed to console for visibility
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
              'docker',
              ['build', '-t', imageTag, workDir],
              {
                  stdio: 'pipe',
              }
          );
      
          // Stream stdout live
          child.stdout.on('data', (data) => {
              process.stdout.write(data);
          });
      
          // Stream stderr live
          child.stderr.on('data', (data) => {
              process.stderr.write(data);
          });
      
          // Optional: realistic timeout (15 min)
          const timeout = setTimeout(() => {
              child.kill('SIGTERM');
              reject(new Error('docker build timed out'));
          }, 15 * 60 * 1000);
      
          // Process finished
          child.on('close', (code) => {
              clearTimeout(timeout);
      
              if (code === 0) {
                  resolve();
              } else {
                  reject(
                      new Error(`docker build failed with exit code ${code}`)
                  );
              }
          });
      
          // Failed to start process itself
          child.on('error', (err) => {
              clearTimeout(timeout);
              reject(err);
          });
      });
        console.log(`[sandbox] image ${imageTag} built successfully`);
        return imageTag;
    }
    catch(error){
        console.error(`[sandbox] failed to build image for ${submissionId}:`, error);
        throw new SandboxBuildError(`Failed to build image for submission ${submissionId}`, error);
    }
    
}