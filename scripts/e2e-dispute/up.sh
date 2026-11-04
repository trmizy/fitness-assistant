#!/usr/bin/env bash
# Builds (from this worktree) and starts the isolated Dispute E2E stack: postgres + auth + payment + user + gym + chat + gateway. Does NOT seed (run seed.sh).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
dc up -d --build --wait --wait-timeout 600
echo
echo "Gateway : http://127.0.0.1:58100   (frontend: GATEWAY_PROXY_TARGET=http://127.0.0.1:58100 CHAT_PROXY_TARGET=http://127.0.0.1:58105)"
echo "Next    : scripts/e2e-dispute/seed.sh   then   scripts/e2e-dispute/status.sh"
