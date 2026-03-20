FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

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

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl wget
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
EXPOSE 3004
CMD ["node", "dist/server.js"]
