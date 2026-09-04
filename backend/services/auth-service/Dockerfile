FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/shared/package.json ./backend/shared/
COPY backend/services/auth-service/package.json ./backend/services/auth-service/
RUN pnpm install --filter @gym-coach/auth-service --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=deps /app/backend/services/auth-service/node_modules ./backend/services/auth-service/node_modules
COPY backend/shared ./backend/shared
COPY backend/services/auth-service ./backend/services/auth-service
COPY tsconfig.base.json ./
RUN pnpm --filter @gym-coach/shared build
RUN pnpm --filter @gym-coach/auth-service db:generate
RUN pnpm --filter @gym-coach/auth-service build
RUN cp -R backend/services/auth-service/src/generated backend/services/auth-service/dist/

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl wget
# Root node_modules includes .pnpm virtual store AND generated Prisma client
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/shared/node_modules ./backend/shared/node_modules
COPY --from=builder /app/backend/shared/dist ./backend/shared/dist
COPY --from=builder /app/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /app/backend/services/auth-service/node_modules ./backend/services/auth-service/node_modules
COPY --from=builder /app/backend/services/auth-service/dist ./backend/services/auth-service/dist
COPY --from=builder /app/backend/services/auth-service/src/generated ./backend/services/auth-service/dist/generated
COPY --from=builder /app/backend/services/auth-service/package.json ./backend/services/auth-service/package.json
COPY --from=builder /app/backend/services/auth-service/prisma ./backend/services/auth-service/prisma
WORKDIR /app/backend/services/auth-service
EXPOSE 3001
# `exec` replaces the shell with the node process instead of forking it as a
# child — without it, Docker's SIGTERM (sent to the shell, PID 1) never
# reaches node, so the app's own process.on("SIGTERM") handler never runs
# and the container always hard-dies on the stop-grace-period SIGKILL
# instead. Verified live (on a sibling service with the same pattern):
# without exec, node stays running after SIGTERM reaches the wrapper shell;
# with it, the shutdown handler fires and the process exits 0.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
