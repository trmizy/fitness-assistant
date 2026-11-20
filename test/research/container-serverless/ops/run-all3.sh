#!/bin/bash
# Final schedule (2026-11-12 ~19:35). Changes vs run-all2, from evidence:
#  - DEV Aurora (max 2 ACU) is CPU-bound at 50-100 req/s of catalogue reads,
#    and stays at ~100% CPU for ~3 min after a Lambda read run, with ~280 idle
#    Lambda connections held afterwards -> carry-over into the next run.
#  - So: cool-down after every DB-backed run, arm order alternated per rep,
#    and container read rep 1 (run right after the Lambda saturation) is
#    replaced by rep 4 (run after a cool-down); rep 1 is kept but excluded.
# Read max 100 req/s (DB-bound); platform-only (401, no DB) max 400 req/s.
set -uo pipefail
cd "$(dirname "$0")/.."
READ_MAX=100; OVH_MAX=400
LOG=results/run-all.log; mkdir -p results
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
LAST_LAMBDA=$(date -d "2026-11-12 19:23:06" +%s)   # end of lambda read r1
run() {
  local arm=$1; log "START $*"
  if ./ops/exp.sh run "$@" >> "$LOG" 2>&1; then log "OK    $*"; else log "FAIL  $*"; fi
  [ "$arm" = lambda ] && LAST_LAMBDA=$(date +%s)
}
cool() { log "cool-down $1 s"; sleep "$1"; }
burst() {
  local rep=$1 idle=$(( $(date +%s) - LAST_LAMBDA ))
  if [ $idle -lt 900 ]; then log "waiting $((900 - idle)) s for Lambda idle"; sleep $((900 - idle)); fi
  run lambda overhead burst "$rep" --burst-size 50
}

log "=== run-all3 start (read max $READ_MAX, overhead max $OVH_MAX) ==="
B=nckh-exp-191798898985-ap-southeast-1
until aws s3 ls "s3://$B/results/container-overhead-steps-r1.csv" --region ap-southeast-1 >/dev/null 2>&1; do sleep 20; done
log "container overhead steps r1 uploaded"

burst 1
run lambda overhead steps 1 --max-rate $OVH_MAX
# rep 2: container first
run container read steps 2 --max-rate $READ_MAX;  cool 180
run lambda    read steps 2 --max-rate $READ_MAX;  cool 300
run container overhead steps 2 --max-rate $OVH_MAX
burst 2
run lambda    overhead steps 2 --max-rate $OVH_MAX
# rep 3: lambda first
run lambda    read steps 3 --max-rate $READ_MAX;  cool 300
run container read steps 3 --max-rate $READ_MAX;  cool 180
run container overhead steps 3 --max-rate $OVH_MAX
burst 3
run lambda    overhead steps 3 --max-rate $OVH_MAX
# replacement for the contaminated container read rep 1
run container read steps 4 --max-rate $READ_MAX;  cool 180
# spikes
run container read spike 1 --max-rate $READ_MAX;  cool 180
run lambda    read spike 1 --max-rate $READ_MAX;  cool 300
# horizontal scaling of the container arm
log "scaling: 2 replicas"; ./ops/exp.sh host 2 --cold >> "$LOG" 2>&1 || log "FAIL host 2"
run container-r2 read steps 1 --max-rate $READ_MAX; cool 180
log "scaling: 3 replicas"; ./ops/exp.sh host 3 --cold >> "$LOG" 2>&1 || log "FAIL host 3"
run container-r3 read steps 1 --max-rate $READ_MAX
log "=== run-all3 done ==="
