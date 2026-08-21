FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/shared/package.json ./backend/shared/
COPY backend/services/user-service/package.json ./backend/services/user-service/
RUN pnpm install --filter @gym-coach/user-service --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=deps /app/backend/services/user-service/node_modules ./backend/services/user-service/node_modules
COPY backend/shared ./backend/shared
COPY backend/services/user-service ./backend/services/user-service
COPY tsconfig.base.json ./
RUN pnpm --filter @gym-coach/shared build
RUN pnpm --filter @gym-coach/user-service db:generate
RUN pnpm --filter @gym-coach/user-service build
RUN cp -R backend/services/user-service/src/generated backend/services/user-service/dist/

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# Root node_modules includes .pnpm virtual store AND generated Prisma client
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=builder /app/backend/shared/dist ./backend/shared/dist
COPY --from=builder /app/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /app/backend/services/user-service/node_modules ./backend/services/user-service/node_modules
COPY --from=builder /app/backend/services/user-service/dist ./backend/services/user-service/dist
COPY --from=builder /app/backend/services/user-service/src/generated ./backend/services/user-service/dist/generated
COPY --from=builder /app/backend/services/user-service/package.json ./backend/services/user-service/package.json
COPY --from=builder /app/backend/services/user-service/prisma ./backend/services/user-service/prisma
WORKDIR /app/backend/services/user-service
RUN mkdir -p uploads/pt-applications
EXPOSE 3004
# Every sibling service's production Dockerfile runs `prisma migrate deploy`
# before starting (auth/fitness/chat/payment/gym) — this one didn't, which
# means a fresh production database would have no user-service tables at
# all. `exec` (not a plain `node dist/server.js` fork) so SIGTERM reaches
# the app's shutdown handler instead of being swallowed by the shell.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
