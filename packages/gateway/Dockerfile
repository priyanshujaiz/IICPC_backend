FROM node:20-slim AS base
RUN npm install -g pnpm

WORKDIR /app

# ── Workspace manifests (layer-cached until these change) ──────────────────
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# ── Only the packages this service needs ──────────────────────────────────
COPY packages/shared ./packages/shared
COPY packages/gateway ./packages/gateway

# ── Install (pnpm links @iicpc/shared → @iicpc/gateway automatically) ─────
RUN pnpm install --frozen-lockfile

# ── Build shared first — gateway imports its compiled dist/ ───────────────
RUN pnpm --filter @iicpc/shared build

# ── Build gateway ─────────────────────────────────────────────────────────
RUN pnpm --filter @iicpc/gateway build

WORKDIR /app/packages/gateway
EXPOSE 3000
CMD ["node", "dist/server.js"]
