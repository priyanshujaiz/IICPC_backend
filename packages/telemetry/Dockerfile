FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./

COPY packages/shared    ./packages/shared
COPY packages/telemetry ./packages/telemetry

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @iicpc/shared build
RUN pnpm --filter @iicpc/telemetry build

WORKDIR /app/packages/telemetry
CMD ["node", "dist/server.js"]
