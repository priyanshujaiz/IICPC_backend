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
COPY packages/leaderboard ./packages/leaderboard

# ── Install (pnpm links @iicpc/shared → @iicpc/leaderboard automatically) ─
RUN pnpm install --frozen-lockfile

# ── Build shared first — leaderboard imports its compiled dist/ ───────────
RUN pnpm --filter @iicpc/shared build

# ── Build leaderboard ─────────────────────────────────────────────────────
RUN pnpm --filter @iicpc/leaderboard build

WORKDIR /app/packages/leaderboard
EXPOSE 4001
CMD ["node", "dist/server.js"]
