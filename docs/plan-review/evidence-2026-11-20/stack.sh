#!/bin/bash
# Local, isolated Plan Review E2E stack: native tsx processes against DISPOSABLE test DBs. No Docker dev stack, no Ollama, no AWS.
ROOT=/c/D_Backup/project_personal/fitness-assistant
SP=/c/Users/ASUS/AppData/Local/Temp/claude/6757a24c7e7edf08/07249fb1-0c21-4885-b207-cbf1d09844a5/scratchpad
PG="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433"
export INTERNAL_SERVICE_SECRET="pr3_internal_secret_at_least_32_characters_long"
export JWT_SECRET="pr3_jwt_secret_at_least_32_characters_long_xx"
export JWT_REFRESH_SECRET="pr3_refresh_secret_at_least_32_characters_long"
export REDIS_HOST=localhost REDIS_PORT=56379 REDIS_URL=redis://localhost:56379
export AUTH_SERVICE_URL=http://localhost:3001 USER_SERVICE_URL=http://localhost:3004 FITNESS_SERVICE_URL=http://localhost:3002
export AI_SERVICE_URL=http://127.0.0.1:1 CHAT_SERVICE_URL=http://127.0.0.1:1 PAYMENT_SERVICE_URL=http://127.0.0.1:1 GYM_SERVICE_URL=http://127.0.0.1:1
export NODE_ENV=development
mkdir -p "$SP/logs"
start() { # name dir db port
  ( cd "$ROOT/$2" && DATABASE_URL="$PG/$3" PORT=$4 nohup ./node_modules/.bin/tsx src/server.ts > "$SP/logs/$1.log" 2>&1 & echo $! > "$SP/logs/$1.pid" )
}
case "$1" in
  up)
    start auth backend/services/auth-service pr3_auth_test 3001
    start user backend/services/user-service pr3_user_test 3004
    start fitness backend/services/fitness-service pr3_fitness_test 3002
    start gateway backend/gateway pr3_auth_test 3000
    ;;
  fitness-up) start fitness backend/services/fitness-service pr3_fitness_test 3002 ;;
  gateway-up) RATE_LIMIT_MAX_REQUESTS=5000 start gateway backend/gateway pr3_auth_test 3000 ;;
  user-up) start user backend/services/user-service pr3_user_test 3004 ;;
  user-down) taskkill //PID "$(cat $SP/logs/user.pid)" //T //F >/dev/null 2>&1; pkill -f "user-service" 2>/dev/null; true ;;
esac
