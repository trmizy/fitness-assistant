FROM node:20-alpine AS builder

RUN npm install -g pnpm@8.15.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/web/package.json ./frontend/web/package.json

RUN pnpm install --filter @gym-coach/web --frozen-lockfile

COPY frontend/web ./frontend/web

ARG VITE_API_URL=http://localhost:3000
ARG VITE_CHAT_WS_URL=http://localhost:3005
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_CHAT_WS_URL=$VITE_CHAT_WS_URL

RUN pnpm --filter @gym-coach/web build

FROM nginx:1.25-alpine AS runner

COPY --from=builder /app/frontend/web/dist /usr/share/nginx/html
COPY frontend/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
