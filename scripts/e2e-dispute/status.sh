#!/usr/bin/env bash
# Health + the runtime-gate verdicts of the isolated stack (read-only).
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
dc ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' 2>&1 | cut -c1-150
echo "--- startup audit lines (runtime gate) ---"
for s in user payment gym; do docker logs "gymini-e2e-dispute-$s" 2>&1 | grep -h "dispute-runtime-gate" | tail -3 | cut -c1-400; done
echo "--- gateway ---"
curl -s -m 5 http://127.0.0.1:58100/health || echo "gateway not reachable"
echo
exec node "$HERE/status.mjs"
