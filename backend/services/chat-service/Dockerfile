FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/shared/package.json ./backend/shared/
COPY backend/services/chat-service/package.json ./backend/services/chat-service/
RUN pnpm install --filter @gym-coach/chat-service --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=deps /app/backend/services/chat-service/node_modules ./backend/services/chat-service/node_modules
COPY backend/shared ./backend/shared
COPY backend/services/chat-service ./backend/services/chat-service
COPY tsconfig.base.json ./
RUN pnpm --filter @gym-coach/shared build
RUN pnpm --filter @gym-coach/chat-service db:generate
RUN pnpm --filter @gym-coach/chat-service build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl wget
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=builder /app/backend/shared/dist ./backend/shared/dist
COPY --from=builder /app/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /app/backend/services/chat-service/node_modules ./backend/services/chat-service/node_modules
COPY --from=builder /app/backend/services/chat-service/dist ./backend/services/chat-service/dist
COPY --from=builder /app/backend/services/chat-service/package.json ./backend/services/chat-service/package.json
COPY --from=builder /app/backend/services/chat-service/prisma ./backend/services/chat-service/prisma
WORKDIR /app/backend/services/chat-service
EXPOSE 3005
# `exec` replaces the shell with the node process instead of forking it as a
# child — without it, Docker's SIGTERM (sent to the shell, PID 1) never
# reaches node, so the app's own process.on("SIGTERM") handler never runs
# and the container always hard-dies on the stop-grace-period SIGKILL
# instead. Verified live: without exec, node stays running after SIGTERM
# reaches the wrapper shell; with it, the shutdown handler fires and the
# process exits 0.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
