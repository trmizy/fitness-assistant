# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@8.15.0

WORKDIR /app

# Copy workspace manifest files first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the web package.json so pnpm can resolve the workspace graph
COPY frontend/web/package.json ./frontend/web/package.json

# Install deps for @gym-coach/web only (no postinstall scripts from other packages)
RUN pnpm install --filter @gym-coach/web --frozen-lockfile

# Copy the full frontend source
COPY frontend/web ./frontend/web

# Build production bundle
RUN pnpm --filter @gym-coach/web build

# ── Stage 2: Serve ───────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS runner

# Copy built assets
COPY --from=builder /app/frontend/web/dist /usr/share/nginx/html

# Copy custom nginx config
COPY frontend/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
