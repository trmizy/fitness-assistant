#!/bin/bash
# Full experiment schedule (~3 h). Arms alternate within each repetition; the
# Lambda arm is left idle for >=15 min (while the container arm runs) before
# every cold-start burst. Scaling runs use arm names container-r2/-r3 so they
# are analysed separately from the 1-replica container arm.
# Usage: ./ops/run-all.sh [max-rate]   (log: results/run-all.log)
set -uo pipefail
cd "$(dirname "$0")/.."
MAX=${1:-400}
LOG=results/run-all.log; mkdir -p results
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
LAST_LAMBDA=0
run() { # run <arm> <workload> <profile> <rep> [extra]
  local arm=$1; log "START $*"
  if ./ops/exp.sh run "$@" >> "$LOG" 2>&1; then log "OK    $*"; else log "FAIL  $*"; fi
  [ "$arm" = lambda ] && LAST_LAMBDA=$(date +%s)
}
burst() { # cold-start probe after >=15 min of Lambda idleness
  local rep=$1 idle=$(( $(date +%s) - LAST_LAMBDA ))
  if [ $idle -lt 900 ]; then log "waiting $((900 - idle)) s for Lambda idle"; sleep $((900 - idle)); fi
  run lambda overhead burst "$rep" --burst-size 50
}

log "=== run-all start (max $MAX req/s) ==="
for rep in 1 2; do
  run lambda    read     steps "$rep" --max-rate "$MAX"
  run container read     steps "$rep" --max-rate "$MAX"
  run container overhead steps "$rep" --max-rate "$MAX"
  burst "$rep"
  run lambda    overhead steps "$rep" --max-rate "$MAX"
done
run lambda    read  steps 3 --max-rate "$MAX"
run container read  steps 3 --max-rate "$MAX"
run container read  spike 1 --max-rate "$MAX"
burst 3
run lambda    read  spike 1 --max-rate "$MAX"

# Horizontal scaling of the container arm (cold start recorded for each set)
log "scaling: 2 replicas"; ./ops/exp.sh host 2 --cold >> "$LOG" 2>&1 || log "FAIL host 2"
run container-r2 read steps 1 --max-rate "$MAX"
log "scaling: 3 replicas"; ./ops/exp.sh host 3 --cold >> "$LOG" 2>&1 || log "FAIL host 3"
run container-r3 read steps 1 --max-rate "$MAX"
log "=== run-all done ==="
