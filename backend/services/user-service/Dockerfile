FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
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

# Python dependencies for InBody OCR extraction
FROM base AS python-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    tesseract-ocr \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/inbody-venv \
    && /opt/inbody-venv/bin/pip install --no-cache-dir \
       torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu \
    && /opt/inbody-venv/bin/pip install --no-cache-dir \
       pydantic pytesseract opencv-python-headless numpy Pillow easyocr

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# Install runtime Python + Tesseract dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    tesseract-ocr \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
# Copy pre-built Python virtualenv from python-deps stage
COPY --from=python-deps /opt/inbody-venv /opt/inbody-venv
ENV PATH="/opt/inbody-venv/bin:$PATH"
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
COPY --from=builder /app/backend/services/user-service/inbody_extractor ./backend/services/user-service/inbody_extractor
WORKDIR /app/backend/services/user-service
RUN mkdir -p uploads/pt-applications
EXPOSE 3004
CMD ["node", "dist/server.js"]
