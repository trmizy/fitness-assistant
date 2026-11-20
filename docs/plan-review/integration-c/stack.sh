#!/bin/bash
# Integration C local stack: native processes on DISPOSABLE *_test databases + test Redis. No Docker dev stack, no Ollama, no AWS, no paid LLM.
ROOT=/c/D_Backup/project_personal/fitness-assistant
HERE="$ROOT/docs/plan-review/integration-c"
LOGS="${C_LOGS:-$HERE/logs}"
PG="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433"
export INTERNAL_SERVICE_SECRET="pr3_internal_secret_at_least_32_characters_long"
export JWT_SECRET="pr3_jwt_secret_at_least_32_characters_long_xx" JWT_REFRESH_SECRET="pr3_refresh_secret_at_least_32_characters_long"
export REDIS_HOST=localhost REDIS_PORT=56379 REDIS_URL=redis://localhost:56379
export AUTH_SERVICE_URL=http://localhost:3001 USER_SERVICE_URL=http://localhost:3004 FITNESS_SERVICE_URL=http://localhost:3002 AI_SERVICE_URL=http://localhost:3003
export CHAT_SERVICE_URL=http://127.0.0.1:1 PAYMENT_SERVICE_URL=http://127.0.0.1:1 GYM_SERVICE_URL=http://127.0.0.1:1
export NODE_ENV=development
export STUB_CONTROL="$HERE/stub-control.json" STUB_CALLS_LOG="$HERE/logs/stub-calls.jsonl"
mkdir -p "$LOGS"
start() { # name dir db port cmd...
  local name=$1 dir=$2 db=$3 port=$4; shift 4
  ( cd "$ROOT/$dir" && DATABASE_URL="$PG/$db" PORT=$port nohup "$@" > "$LOGS/$name.log" 2>&1 & )
}
TSX=./node_modules/.bin/tsx
case "$1" in
  up)
    start auth backend/services/auth-service pr3_auth_test 3001 $TSX src/server.ts
    start user backend/services/user-service pr3_user_test 3004 $TSX src/server.ts
    start fitness backend/services/fitness-service pr3_fitness_test 3002 $TSX src/server.ts
    LLM_PROVIDER=mock DISABLE_AI_PLAN_EVIDENCE=true AI_EXPENSIVE_RATE_LIMIT_MAX=1000 AI_ASK_RATE_LIMIT_MAX=1000 \
      start ai backend/services/ai-service revision_ai_test 3003 $TSX "$HERE/ai-stub-launcher.ts"
    RATE_LIMIT_MAX_REQUESTS=5000 start gateway backend/gateway pr3_auth_test 3000 $TSX src/server.ts
    ( cd "$ROOT/frontend/web" && nohup ./node_modules/.bin/vite --port 5173 --host 127.0.0.1 > "$LOGS/web.log" 2>&1 & )
    ;;
  gateway-up) RATE_LIMIT_MAX_REQUESTS=5000 start gateway backend/gateway pr3_auth_test 3000 $TSX src/server.ts ;;
  user-up) start user backend/services/user-service pr3_user_test 3004 $TSX src/server.ts ;;
  fitness-up) start fitness backend/services/fitness-service pr3_fitness_test 3002 $TSX src/server.ts ;;
  ai-up) LLM_PROVIDER=mock DISABLE_AI_PLAN_EVIDENCE=true AI_EXPENSIVE_RATE_LIMIT_MAX=1000 AI_ASK_RATE_LIMIT_MAX=1000 start ai backend/services/ai-service revision_ai_test 3003 $TSX "$HERE/ai-stub-launcher.ts" ;;
esac
