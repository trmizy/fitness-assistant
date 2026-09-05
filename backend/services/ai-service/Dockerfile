FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/shared/package.json ./backend/shared/
COPY backend/services/ai-service/package.json ./backend/services/ai-service/
RUN pnpm install --filter @gym-coach/ai-service --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=deps /app/backend/services/ai-service/node_modules ./backend/services/ai-service/node_modules
COPY backend/shared/ ./backend/shared/
COPY backend/services/ai-service/ ./backend/services/ai-service/
COPY tsconfig.base.json ./
RUN pnpm --filter @gym-coach/shared build
RUN pnpm --filter @gym-coach/ai-service db:generate
RUN pnpm --filter @gym-coach/ai-service build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl wget
# Root node_modules includes .pnpm virtual store AND generated Prisma client
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=builder /app/backend/shared/dist ./backend/shared/dist
COPY --from=builder /app/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /app/backend/services/ai-service/node_modules ./backend/services/ai-service/node_modules
COPY --from=builder /app/backend/services/ai-service/dist ./backend/services/ai-service/dist
COPY --from=builder /app/backend/services/ai-service/src/generated ./backend/services/ai-service/dist/generated
COPY --from=builder /app/backend/services/ai-service/package.json ./backend/services/ai-service/package.json
COPY --from=builder /app/backend/services/ai-service/prisma ./backend/services/ai-service/prisma
# Local seed datasets (e.g. free-exercise-db/exercises.json) are read at
# runtime via process.cwd()-relative paths (datasetConfig.ts) — without this,
# the runner stage silently drops them since only dist/ was copied above,
# and the free-exercise-db provider degrades to 0 results without crashing
# (by design), masking the gap in production.
COPY --from=builder /app/backend/services/ai-service/data ./backend/services/ai-service/data
WORKDIR /app/backend/services/ai-service
# Security review 2026-09-03 (H5) — ran as root by default; base node:20-alpine already ships
# a non-root "node" user (uid 1000) built for exactly this.
USER node
EXPOSE 3003
# `exec` replaces the shell with the node process instead of forking it as a
# child — without it, Docker's SIGTERM (sent to the shell, PID 1) never
# reaches node, so the app's own process.on("SIGTERM") handler never runs
# and the container always hard-dies on the stop-grace-period SIGKILL
# instead. Verified live (on a sibling service with the same pattern):
# without exec, node stays running after SIGTERM reaches the wrapper shell;
# with it, the shutdown handler fires and the process exits 0.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
