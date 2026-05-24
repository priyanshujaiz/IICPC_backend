FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Only the packages this service needs
COPY packages/shared   ./packages/shared
COPY packages/bot-fleet ./packages/bot-fleet

RUN pnpm install --frozen-lockfile

# Build shared first, then bot-fleet
RUN pnpm --filter @iicpc/shared build
RUN pnpm --filter @iicpc/bot-fleet build

WORKDIR /app/packages/bot-fleet
CMD ["node", "dist/orchestrator.js"]
