#!/bin/bash
# Local orchestrator for the container-vs-serverless experiment.
# Requires: AWS CLI (account 191798898985, ap-southeast-1), DEV started with
# scripts/aws/dev-start.ps1 -Backend (Aurora + NAT + Secrets endpoint).
#
#   ./exp.sh deploy                      create the temporary stack
#   ./exp.sh push                        upload entry.js, Dockerfile, loadgen.mjs
#   ./exp.sh host <replicas> [--cold]    build + start container replicas
#   ./exp.sh run <arm> <workload> <profile> <rep> [loadgen args...]
#   ./exp.sh fetch                       download results/*.csv|json
#   ./exp.sh collect                     CloudWatch evidence -> results/aws.json
#   ./exp.sh teardown                    empty bucket, delete stack
set -euo pipefail
export MSYS_NO_PATHCONV=1 AWS_DEFAULT_REGION=ap-southeast-1 PYTHONIOENCODING=utf-8 PYTHONUTF8=1
STACK=nckh-exp-container-serverless
# Windows-style path (C:/...) so the Windows AWS CLI and Python can open files.
HERE="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
LAMBDA_URL=https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com

out() { aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

ssm() { # ssm <instance-id> <timeout-s> <command...>
  local id=$1 to=$2; shift 2
  local params; params=$(python -c 'import json,sys; print(json.dumps({"commands": [sys.argv[1]], "executionTimeout": [sys.argv[2]]}))' "$*" "$to")
  local cid; cid=$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript \
    --timeout-seconds 60 --parameters "$params" --query Command.CommandId --output text)
  while :; do
    sleep 5
    local st; st=$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$id" --query Status --output text 2>/dev/null || echo Pending)
    case $st in Success|Failed|Cancelled|TimedOut) break;; esac
  done
  aws ssm get-command-invocation --command-id "$cid" --instance-id "$id" --query "[StandardOutputContent,StandardErrorContent]" --output text
  [ "$st" = Success ]
}

case ${1:-} in
  deploy)
    aws cloudformation deploy --stack-name $STACK --template-file "$HERE/infra/experiment-stack.yaml" \
      --capabilities CAPABILITY_IAM --tags Project=nckh-exp
    aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs" --output table ;;
  push)
    B=$(out Bucket)
    aws s3 cp "$HERE/container/entry.js" "s3://$B/code/entry.js" --quiet
    aws s3 cp "$HERE/container/Dockerfile" "s3://$B/code/Dockerfile" --quiet
    aws s3 cp "$HERE/ops/host-setup.sh" "s3://$B/code/host-setup.sh" --quiet
    aws s3 cp "$HERE/loadgen/loadgen.mjs" "s3://$B/code/loadgen.mjs" --quiet
    echo pushed ;;
  host)
    B=$(out Bucket); H=$(out HostInstanceId)
    ssm "$H" 900 "aws s3 cp s3://$B/code/host-setup.sh /opt/fitness/host-setup.sh --region ap-southeast-1 --quiet && bash /opt/fitness/host-setup.sh $B ${2:-1} ${3:-}" ;;
  run)
    arm=$2 wl=$3 prof=$4 rep=$5; shift 5
    B=$(out Bucket); L=$(out LoadGenInstanceId)
    if [ "$arm" = lambda ]; then BASE=$LAMBDA_URL; else BASE=$(out AlbUrl); fi
    name="$arm-$wl-$prof-r$rep.csv"
    ssm "$L" 7200 "set -e; cd /opt/lg; test -f USERDATA_DONE; aws s3 cp s3://$B/code/loadgen.mjs loadgen.mjs --region ap-southeast-1 --quiet; \
      docker run --rm --network host -v /opt/lg:/lg -w /lg --entrypoint /var/lang/bin/node public.ecr.aws/lambda/nodejs:22 \
      loadgen.mjs --base $BASE --arm $arm --workload $wl --profile $prof --rep $rep --out results/$name $*; \
      aws s3 cp results/$name s3://$B/results/$name --region ap-southeast-1 --quiet" ;;
  fetch)
    B=$(out Bucket); mkdir -p "$HERE/results"
    aws s3 sync "s3://$B/results/" "$HERE/results/" --quiet
    # merge container start-up timings into one file for analyze.py
    python - "$HERE/results" <<'EOF'
import glob, json, os, sys
d = sys.argv[1]; runs = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(d, "container_start-*.json")))]
if runs: json.dump(runs, open(os.path.join(d, "container_start.json"), "w"), indent=1)
EOF
    ls -la "$HERE/results" ;;
  collect)
    python "$HERE/analysis/collect_aws.py" --results "$HERE/results" --out "$HERE/results/aws.json" \
      --alb-suffix "$(out AlbFullName)" --tg-suffix "$(out TargetGroupFullName)" --instance "$(out HostInstanceId)" ;;
  teardown)
    B=$(out Bucket) || true
    [ -n "${B:-}" ] && aws s3 rm "s3://$B" --recursive --quiet || true
    aws cloudformation delete-stack --stack-name $STACK
    aws cloudformation wait stack-delete-complete --stack-name $STACK && echo "stack deleted" ;;
  *) sed -n 2,14p "$0"; exit 1 ;;
esac
