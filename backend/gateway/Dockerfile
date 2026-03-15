FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/shared/package.json ./backend/shared/
COPY backend/gateway/package.json ./backend/gateway/
RUN pnpm install --filter @gym-coach/api-gateway --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=deps /app/backend/gateway/node_modules ./backend/gateway/node_modules
COPY backend/shared/ ./backend/shared/
COPY backend/gateway/ ./backend/gateway/
COPY tsconfig.base.json ./
RUN pnpm --filter @gym-coach/shared build
RUN pnpm --filter @gym-coach/api-gateway build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget
# Root node_modules must be included — pnpm stores actual packages in .pnpm virtual store here
COPY --from=builder /app/node_modules ./node_modules
# Per-package node_modules contain symlinks into root .pnpm store
COPY --from=builder /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=builder /app/backend/shared/dist ./backend/shared/dist
COPY --from=builder /app/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /app/backend/gateway/node_modules ./backend/gateway/node_modules
COPY --from=builder /app/backend/gateway/dist ./backend/gateway/dist
COPY --from=builder /app/backend/gateway/package.json ./backend/gateway/package.json
WORKDIR /app/backend/gateway
EXPOSE 3000
CMD ["node", "dist/server.js"]
