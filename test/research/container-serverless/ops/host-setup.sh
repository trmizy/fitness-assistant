#!/bin/bash
# Runs ON the container host (via SSM). Builds the image from the unmodified
# Lambda artifact and (re)starts N replicas, each limited to the CPU/memory a
# 1024 MB Lambda gets (1769 MB = 1 vCPU  ->  1024 MB ~= 0.58 vCPU).
# Usage: host-setup.sh <bucket> <replicas> [--cold]
#   --cold : stop everything first and record container start-up time
#            (docker run -> first healthy /health) into the bucket.
set -euo pipefail
BUCKET=$1; N=${2:-1}; COLD=${3:-}
REGION=ap-southeast-1; FN=fitness-assistant-dev-fitness
cd /opt/fitness
test -f USERDATA_DONE
aws s3 cp "s3://$BUCKET/code/entry.js" entry.js --region $REGION --quiet
aws s3 cp "s3://$BUCKET/code/Dockerfile" Dockerfile --region $REGION --quiet

# Same environment variables as the Lambda function (values never printed).
aws lambda get-function-configuration --region $REGION --function-name $FN \
  --query Environment.Variables --output json > env.json
python3 - <<'EOF'
import json
env = json.load(open("env.json"))
env.update({"AWS_REGION": "ap-southeast-1", "FITNESS_DISABLE_REDIS": "true"})
with open("fitness.env", "w") as f:
    for k, v in env.items():
        f.write(f"{k}={v}\n")
EOF
chmod 600 fitness.env env.json
docker build -q -t fitness-exp . >/dev/null

docker rm -f $(docker ps -aq --filter name=fitness-) >/dev/null 2>&1 || true
STARTS="["
for i in $(seq 1 "$N"); do
  PORT=$((3001 + i))
  T0=$(date +%s%3N)
  docker run -d --name "fitness-$i" --restart unless-stopped --network host \
    --cpus 0.58 --memory 1024m --env-file fitness.env -e PORT=$PORT fitness-exp >/dev/null
  until curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; do sleep 0.05; done
  T1=$(date +%s%3N)
  # first DB-backed request (comparable to a Lambda cold start + first query)
  curl -sf "http://127.0.0.1:$PORT/exercises?limit=1" >/dev/null
  T2=$(date +%s%3N)
  STARTS="$STARTS{\"replica\":$i,\"ready_ms\":$((T1-T0)),\"first_db_response_ms\":$((T2-T0))},"
done
STARTS="${STARTS%,}]"
echo "$STARTS"
if [ "$COLD" = "--cold" ]; then
  echo "{\"t\":\"$(date -u +%FT%TZ)\",\"replicas\":$N,\"starts\":$STARTS}" > container_start.json
  aws s3 cp container_start.json "s3://$BUCKET/results/container_start-$(date +%s).json" --region $REGION --quiet
fi
docker ps --format '{{.Names}} {{.Status}}'
