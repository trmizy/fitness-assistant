FROM node:20-alpine AS builder

RUN npm install -g pnpm@8.15.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/New/package.json ./frontend/New/package.json

RUN pnpm install --filter @figma/my-make-file --frozen-lockfile

COPY frontend/New ./frontend/New

ARG VITE_API_URL=http://localhost:3000
ARG VITE_CHAT_WS_URL=http://localhost:3005
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_CHAT_WS_URL=$VITE_CHAT_WS_URL

RUN pnpm --filter @figma/my-make-file build

FROM nginx:1.25-alpine AS runner

COPY --from=builder /app/frontend/New/dist /usr/share/nginx/html
COPY frontend/New/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
