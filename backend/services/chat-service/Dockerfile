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
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/server.js"]
