# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@8.15.0

WORKDIR /app

# Copy workspace manifest files first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the New package.json so pnpm can resolve the workspace graph
COPY frontend/New/package.json ./frontend/New/package.json

# Install deps for @figma/my-make-file (the name in New/package.json)
RUN pnpm install --filter @figma/my-make-file --frozen-lockfile

# Copy the full frontend source
COPY frontend/New ./frontend/New

# Vite bakes env vars at build time — pass them via --build-arg
ARG VITE_API_URL=http://localhost:3000
ARG VITE_CHAT_WS_URL=http://localhost:3005
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_CHAT_WS_URL=$VITE_CHAT_WS_URL

# Build production bundle
RUN pnpm --filter @figma/my-make-file build

# ── Stage 2: Serve ───────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS runner

# Copy built assets
COPY --from=builder /app/frontend/New/dist /usr/share/nginx/html

# Copy custom nginx config
COPY frontend/New/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
