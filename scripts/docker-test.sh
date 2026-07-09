#!/usr/bin/env sh
set -eu

PROFILE="${1:-fast}"
if [ "$PROFILE" != "fast" ] && [ "$PROFILE" != "full" ]; then
  echo "Usage: scripts/docker-test.sh [fast|full]" >&2
  exit 2
fi

PROFILES="--profile $PROFILE"
if [ "$PROFILE" = "full" ] && [ "${USE_OLLAMA:-false}" = "true" ]; then
  PROFILES="$PROFILES --profile ollama"
  export LLM_PROVIDER=ollama
fi

echo "[docker-test] profile=$PROFILE use_ollama=${USE_OLLAMA:-false}"
docker compose -f docker-compose.test.yml $PROFILES up --abort-on-container-exit --exit-code-from "test-runner-$PROFILE"
status=$?
docker compose -f docker-compose.test.yml $PROFILES down -v --remove-orphans
exit $status