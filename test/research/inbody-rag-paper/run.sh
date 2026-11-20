#!/usr/bin/env bash
# Usage: bash test/research/inbody-rag-paper/run.sh <script.ts> [args...]
# Runs a harness script with the production ai-service modules and the Bedrock/Qdrant settings used in the paper.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../../../backend/services/ai-service"
export LLM_PROVIDER=bedrock BEDROCK_CHAT_MODEL=apac.amazon.nova-pro-v1:0 BEDROCK_REGION=ap-southeast-1 AWS_REGION=ap-southeast-1
export AWS_PROFILE="${AWS_PROFILE:-divuzha}" AWS_SDK_LOAD_CONFIG=1
export EMBEDDING_PROVIDER=bedrock BEDROCK_EMBEDDING_MODEL=cohere.embed-multilingual-v3 KNOWLEDGE_VECTOR_SIZE=1024 EMBEDDING_DIMENSIONS=1024
export QDRANT_HOST=localhost QDRANT_PORT=6340 LOG_LEVEL=warn
script="$1"; shift
exec ./node_modules/.bin/tsx "$here/$script" "$@"
