#!/bin/sh
set -eu

PROFILE="${DOCKER_TEST_PROFILE:-fast}"
export NODE_ENV=test
export ENABLE_RESEARCH_AUTOMATION=false
export DISABLE_EXTERNAL_RESEARCH_FETCH=true
export RESEARCH_REQUIRE_REVIEW_FOR_WEB=true
export DEBUG_RAG=false

printf '\n[docker-test] profile=%s\n' "$PROFILE"
if [ ! -d node_modules ]; then
  printf '[docker-test] installing workspace dependencies with lockfile\n'
  corepack enable >/dev/null 2>&1 || true
  pnpm install --frozen-lockfile
else
  printf '[docker-test] using dependencies baked into Docker image\n'
fi

printf '\n[docker-test] prisma generate\n'
pnpm run prisma:generate

if [ "$PROFILE" = "full" ]; then
  printf '\n[docker-test] applying test database migrations\n'
  pnpm run prisma:migrate:test
fi

printf '\n[docker-test] root build\n'
pnpm run build

printf '\n[docker-test] unit tests\n'
pnpm test

printf '\n[docker-test] ai-service build\n'
pnpm --filter @gym-coach/ai-service run build

printf '\n[docker-test] research dry-run/eval\n'
pnpm --filter @gym-coach/ai-service run knowledge:research:dry-run
pnpm --filter @gym-coach/ai-service run knowledge:research:eval

if [ "$PROFILE" = "full" ]; then
  printf '\n[docker-test] AI/RAG checks\n'
  if [ "${LLM_PROVIDER:-mock}" = "ollama" ]; then
    printf '[docker-test] checking Ollama models at %s\n' "${LLM_BASE_URL:-http://ollama-test:11434}"
node <<'NODE'
const baseUrl = process.env.LLM_BASE_URL || 'http://ollama-test:11434';
const chatModel = process.env.LLM_MODEL || 'llama3.2:3b';
const embeddingModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

(async () => {
try {
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const models = Array.isArray(data.models) ? data.models : [];
  const names = new Set(models.flatMap((item) => [item.name, item.model].filter(Boolean)));
  const missing = [chatModel, embeddingModel].filter((name) => !names.has(name) && !names.has(`${name}:latest`));
  if (missing.length > 0) {
    console.error(`[docker-test] Missing Ollama model(s): ${missing.join(', ')}`);
    console.error(`[docker-test] Pull them before USE_OLLAMA=true full tests, for example:`);
    for (const model of missing) console.error(`  docker compose -f docker-compose.test.yml --profile ollama run --rm ollama-test ollama pull ${model}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`[docker-test] Ollama is not healthy at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
})();
NODE
    pnpm --filter @gym-coach/ai-service run ai:test:seed-rag
    pnpm --filter @gym-coach/ai-service run ai:test:rag
    RAG_RETRIEVAL_EVAL_DATASET=data/eval/retrieval/docker-test-retrieval.csv \
      RAG_RETRIEVAL_EVAL_MIN_HIT=1 \
      RAG_RETRIEVAL_EVAL_MIN_MRR=1 \
      pnpm --filter @gym-coach/ai-service run ai:eval:retrieval
  else
    printf '[docker-test] LLM_PROVIDER=%s, seeding Qdrant with mock embeddings for AI/RAG checks.\n' "${LLM_PROVIDER:-mock}"
    pnpm --filter @gym-coach/ai-service run ai:test:seed-rag
    pnpm --filter @gym-coach/ai-service run ai:test:rag
    RAG_RETRIEVAL_EVAL_DATASET=data/eval/retrieval/docker-test-retrieval.csv \
      RAG_RETRIEVAL_EVAL_MIN_HIT=1 \
      RAG_RETRIEVAL_EVAL_MIN_MRR=1 \
      pnpm --filter @gym-coach/ai-service run ai:eval:retrieval
  fi
  pnpm --filter @gym-coach/ai-service run test:policy
  pnpm --filter @gym-coach/ai-service run test:evaluation
fi

printf '\n[docker-test] PASS profile=%s\n' "$PROFILE"
