#!/usr/bin/env bash
# CLEAN CHECKOUT check: `git archive` of the current HEAD into a fresh temp dir (so only COMMITTED files exist), then `prisma generate` + `tsc --noEmit` for
# user / payment / gym / gateway. node_modules are NOT installed: they are junctioned to the existing install of the main tree (no pnpm install, nothing deleted).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$(mktemp -d)}"; [ -d "$OUT" ] && [ -z "$(ls -A "$OUT")" ] || { echo "target must be an empty dir: $OUT" >&2; exit 2; }
MAIN="${MAIN_TREE:-/d/FitnessAssistant}"
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$OUT"
echo "archived $(git -C "$ROOT" rev-parse --short HEAD) into $OUT"
win() { cygpath -w "$1"; }
junction() { cmd //c "mklink /J $(win "$1") $(win "$2")" >/dev/null; }
junction "$OUT/node_modules" "$MAIN/node_modules"
rc=0
for p in backend/services/user-service backend/services/payment-service backend/services/gym-service backend/gateway; do
  [ -d "$MAIN/$p/node_modules" ] && junction "$OUT/$p/node_modules" "$MAIN/$p/node_modules"
  (
    cd "$OUT/$p" || exit 1
    if [ -f prisma/schema.prisma ]; then node_modules/.bin/prisma generate >/dev/null 2>"$OUT/gen.err" || { echo "FAIL prisma generate $p"; tail -3 "$OUT/gen.err"; exit 1; }; fi
    node_modules/.bin/tsc --noEmit -p . > "$OUT/tsc.err" 2>&1 && echo "OK   $p: prisma generate + tsc --noEmit" || { echo "FAIL tsc $p"; head -5 "$OUT/tsc.err"; exit 1; }
  ) || rc=1
done
# remove only the junctions we made (rmdir on a junction never touches its target), then the temp tree
for p in "" backend/services/user-service backend/services/payment-service backend/services/gym-service backend/gateway; do [ -d "$OUT/$p/node_modules" ] && cmd //c "rmdir $(win "$OUT/$p/node_modules")" >/dev/null; done
rm -rf "$OUT"
exit $rc
