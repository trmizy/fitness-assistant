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
COPY --from=builder /app/backend/services/ai-service/package.json ./backend/services/ai-service/package.json
COPY --from=builder /app/backend/services/ai-service/prisma ./backend/services/ai-service/prisma
WORKDIR /app/backend/services/ai-service
EXPOSE 3003
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/server.js"]
