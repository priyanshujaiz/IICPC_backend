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
COPY packages/sandbox ./packages/sandbox

# ── Install (pnpm links @iicpc/shared → @iicpc/sandbox automatically) ─────
RUN pnpm install --frozen-lockfile

# ── Build shared first — sandbox imports its compiled dist/ ───────────────
RUN pnpm --filter @iicpc/shared build

# ── Build sandbox ─────────────────────────────────────────────────────────
RUN pnpm --filter @iicpc/sandbox build

WORKDIR /app/packages/sandbox
EXPOSE 3001
CMD ["node", "dist/server.js"]
