#!/bin/bash
# Revised schedule (2026-11-12 19:3x), after run 1 showed the DEV Aurora
# (max 2 ACU) saturating at 50-100 req/s of catalogue reads: Lambda scaled to
# 914 concurrent executions (account limit 1000) and 658 DB connections.
# DB-backed reads are therefore capped at 100 req/s; the platform-only
# workload (401, no DB) keeps the approved 400 req/s.
# Already done before this script: lambda read steps r1 (aborted at 200,
# steps <=100 complete) and container read steps r1 (max 400, in flight).
set -uo pipefail
cd "$(dirname "$0")/.."
READ_MAX=100; OVH_MAX=400
LOG=results/run-all.log; mkdir -p results
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
LAST_LAMBDA=$(date +%s)
run() {
  local arm=$1; log "START $*"
  if ./ops/exp.sh run "$@" >> "$LOG" 2>&1; then log "OK    $*"; else log "FAIL  $*"; fi
  [ "$arm" = lambda ] && LAST_LAMBDA=$(date +%s)
}
burst() {
  local rep=$1 idle=$(( $(date +%s) - LAST_LAMBDA ))
  if [ $idle -lt 900 ]; then log "waiting $((900 - idle)) s for Lambda idle"; sleep $((900 - idle)); fi
  run lambda overhead burst "$rep" --burst-size 50
}

log "=== run-all2 start (read max $READ_MAX, overhead max $OVH_MAX) ==="
B=nckh-exp-191798898985-ap-southeast-1
until aws s3 ls "s3://$B/results/container-read-steps-r1.csv" --region ap-southeast-1 >/dev/null 2>&1; do sleep 20; done
log "container read steps r1 uploaded"

run container overhead steps 1 --max-rate $OVH_MAX
burst 1
run lambda    overhead steps 1 --max-rate $OVH_MAX
for rep in 2 3; do
  run lambda    read     steps $rep --max-rate $READ_MAX
  run container read     steps $rep --max-rate $READ_MAX
  run container overhead steps $rep --max-rate $OVH_MAX
  burst $rep
  run lambda    overhead steps $rep --max-rate $OVH_MAX
done
run container read spike 1 --max-rate $READ_MAX
run lambda    read spike 1 --max-rate $READ_MAX

log "scaling: 2 replicas"; ./ops/exp.sh host 2 --cold >> "$LOG" 2>&1 || log "FAIL host 2"
run container-r2 read steps 1 --max-rate $READ_MAX
log "scaling: 3 replicas"; ./ops/exp.sh host 3 --cold >> "$LOG" 2>&1 || log "FAIL host 3"
run container-r3 read steps 1 --max-rate $READ_MAX
log "=== run-all2 done ==="
