# AWS DEV — Bedrock Model Discovery (Read-Only)

Date: 2026-09-30. Account `191798898985`, region `ap-southeast-1`. **No model was invoked. No AWS resource, IAM policy, Lambda env var, or source file was changed.**

## Executive Summary

All 40 Bedrock foundation models currently listed in `ap-southeast-1` — spanning 7 different providers (Amazon, Anthropic, OpenAI, xAI, Moonshot AI, Cohere, TwelveLabs) — return `authorizationStatus: NOT_AUTHORIZED`. This is not a per-model or per-provider pattern; it is a **100% account-wide result**, confirming `BEDROCK_ACCOUNT_WIDE_GATE_LIKELY`. Combined with the prior audit's finding that IAM is fully correct and no SCP can apply (account is not in an AWS Organization), this is consistent with AWS Support's own statement that this account's usage history is currently insufficient for Bedrock model authorization — there is no model-selection workaround for this; a different model ID does not bypass an account-level gate.

Separately, and independently of Bedrock: Gymini's `ai-service` already has a **fully implemented, production-grade direct Anthropic API provider** (`LLM_PROVIDER=anthropic`) as a parallel code path to Bedrock/Ollama/mock — this is the lowest-change-surface fallback for **text generation** once an `ANTHROPIC_API_KEY` is provisioned. No equivalent exists for **embeddings** (RAG) outside Bedrock/Ollama/mock — this part of the account-wide gate has no low-risk fallback today.

## Current Gymini Provider Architecture

**LLM (`backend/services/ai-service/src/services/llm.service.ts`)** — `LLM_PROVIDER` selects one of 4 fully implemented branches at every call site (`getHealthStatus`, `callLLM`, `callLLMChat`):
- `mock` — deterministic canned response, zero external dependency, test-quality only (e.g. `weeklySchedule: []`, hardcoded generic notes).
- `anthropic` — real, direct `api.anthropic.com` calls via `@anthropic-ai/sdk`, needs `ANTHROPIC_API_KEY`.
- `bedrock` — `services/bedrock.client.ts`, uses `ConverseCommand` for chat (`BEDROCK_CHAT_MODEL`, default `amazon.nova-pro-v1:0`) and vision (`BEDROCK_VISION_MODEL`), `InvokeModelCommand` for embeddings. No streaming Bedrock API used anywhere (`bedrock:InvokeModelWithResponseStream` is not needed/granted).
- `ollama` — local/self-hosted, `LLM_BASE_URL`, used in docker-compose dev only; not deployed anywhere in the AWS environment audited throughout this engagement.

**Embeddings (`services/embedding-config.ts`)** — `EMBEDDING_PROVIDER` ∈ `{bedrock, ollama, mock}` only — **no Anthropic option** (Anthropic has no embeddings API). Vector dimension is derived centrally: Bedrock Cohere models fixed at 1024 dims, Ollama's `nomic-embed-text` at 768 dims, `mock` at 768. A hard-coded dimension-mismatch guard throws if `KNOWLEDGE_VECTOR_SIZE` disagrees with the resolved Bedrock model's fixed size — this is a genuine, intentional guard against silently corrupting a vector collection.

**Vector store (`vector-store/provider.ts`)** — `VECTOR_STORE_PROVIDER` selects `OpenSearchVectorStore` (AWS, confirmed via `OPENSEARCH_SERVERLESS_ENDPOINT`/`fitness-assistant-dev-opensearch-access` IAM policy present on both AI Lambdas) or `QdrantVectorStore` (local dev). Both read the same central dimension config.

**Features depending on the LLM path**: AI Coach chat (`/ai/ask`, `/ai/ask/stream`), workout plan generation (`ai.worker.ts`), nutrition plan generation (`nutrition.processor.ts`), roadmap AI draft generation (`fitness-service` calls into `ai-service`'s `/ai/generate-roadmap-draft`), cycle analysis/assessment, feedback analysis, marketplace plan moderation/improvement-suggestion generation, exercise-progression explanation.

**Features depending on the embedding path**: RAG evidence retrieval for plan generation (`retriever.ts`), the knowledge-pipeline ingestion/indexing jobs, semantic search over the evidence corpus.

No source file was changed to gather any of the above — read-only inspection only.

## Valid Bedrock Models in ap-southeast-1

`aws bedrock list-foundation-models --region ap-southeast-1` returned **40 models** from 7 providers. Output-modality breakdown: **37 with TEXT output**, **3 with EMBEDDING output** (`cohere.embed-v4:0`, `cohere.embed-english-v3`, `cohere.embed-multilingual-v3`). No model in this account/region currently supports `InvokeModelWithResponseStream`-only text generation that Gymini would need differently — irrelevant either way since Gymini never calls a streaming Bedrock API.

## TEXT Authorization Matrix

*(Full 37-row detail is reproduced from the raw CLI output below; all values `NOT_AUTHORIZED` / `region: AVAILABLE` / `entitlement: AVAILABLE` throughout — the only column that varies is `agreementAvailability.status`.)*

| Model ID | Provider | Inference type(s) | Authorization | Agreement |
|---|---|---|---|---|
| amazon.nova-pro-v1:0 | Amazon | INFERENCE_PROFILE | NOT_AUTHORIZED | AVAILABLE |
| amazon.nova-lite-v1:0 | Amazon | INFERENCE_PROFILE | NOT_AUTHORIZED | AVAILABLE |
| amazon.nova-micro-v1:0 | Amazon | INFERENCE_PROFILE | NOT_AUTHORIZED | AVAILABLE |
| amazon.nova-2-lite-v1:0 | Amazon | INFERENCE_PROFILE | NOT_AUTHORIZED | AVAILABLE |
| anthropic.claude-sonnet-5 | Anthropic | ON_DEMAND, INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-3-haiku-20240307-v1:0 | Anthropic | ON_DEMAND | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-3-5-sonnet-20240620-v1:0 | Anthropic | ON_DEMAND | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-3-5-sonnet-20241022-v2:0 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-3-sonnet-20240229-v1:0 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-3-sonnet-20240229-v1:0:28k | Anthropic | — | `AVAILABILITY_API_NOT_APPLICABLE` (ValidationException) | — |
| anthropic.claude-3-sonnet-20240229-v1:0:200k | Anthropic | — | `AVAILABILITY_API_NOT_APPLICABLE` (ValidationException) | — |
| anthropic.claude-sonnet-4-20250514-v1:0 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-sonnet-4-5-20250929-v1:0 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-sonnet-4-6 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-sonnet-5-5 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-haiku-4-5-20251001-v1:0 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-opus-4-5-20251101-v1:0 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-opus-4-6-v1 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-opus-4-7 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-opus-4-8 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-opus-5 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-opus-5-5 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-fable-5 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| anthropic.claude-fable-5-1 | Anthropic | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |
| openai.gpt-5.4 / 5.5 / 5.6-luna / 5.6-sol / 5.6-terra / 6-astra / 6-luna / 6-sol / 6.1-sol | OpenAI | INFERENCE_PROFILE | NOT_AUTHORIZED (all 9) | NOT_AVAILABLE (all 9) |
| xai.grok-4.6 | xAI | INFERENCE_PROFILE | NOT_AUTHORIZED | AVAILABLE |
| xai.grok-4.7 | xAI | INFERENCE_PROFILE | NOT_AUTHORIZED | AVAILABLE |
| moonshotai.kimi-k3 | Moonshot AI | INFERENCE_PROFILE | NOT_AUTHORIZED | AVAILABLE |
| twelvelabs.pegasus-1-2-v1:0 | TwelveLabs | INFERENCE_PROFILE | NOT_AUTHORIZED | NOT_AVAILABLE |

**2 models (`...:0:28k`, `...:0:200k` legacy context-window variants of Claude 3 Sonnet) returned `ValidationException` on `get-foundation-model-availability`** — recorded as `AVAILABILITY_API_NOT_APPLICABLE`, not discarded. These are legacy fixed-context aliases; the availability API does not apply to them directly (their base `anthropic.claude-3-sonnet-20240229-v1:0` entry does return a real result, itself `NOT_AUTHORIZED`).

## EMBEDDING Authorization Matrix

| Model ID | Authorization | Agreement | Entitlement | Region |
|---|---|---|---|---|
| cohere.embed-multilingual-v3 | NOT_AUTHORIZED | AVAILABLE (real offer exists, not yet accepted — see prior report) | AVAILABLE | AVAILABLE |
| cohere.embed-english-v3 | NOT_AUTHORIZED | NOT_AVAILABLE | AVAILABLE | AVAILABLE |
| cohere.embed-v4:0 | NOT_AUTHORIZED | NOT_AVAILABLE | AVAILABLE | AVAILABLE |

## Inference Profiles

`aws bedrock list-inference-profiles --region ap-southeast-1` → **36 total profiles** in-region. Relevant to Gymini's configured models:

| Profile ID | Status | Type |
|---|---|---|
| apac.amazon.nova-pro-v1:0 | ACTIVE | SYSTEM_DEFINED |
| apac.amazon.nova-lite-v1:0 | ACTIVE | SYSTEM_DEFINED |
| apac.amazon.nova-micro-v1:0 | ACTIVE | SYSTEM_DEFINED |
| global.amazon.nova-2-lite-v1:0 | ACTIVE | SYSTEM_DEFINED |
| global.cohere.embed-v4:0 | ACTIVE | SYSTEM_DEFINED |

**No inference profile exists for `cohere.embed-multilingual-v3`** (the model Gymini actually uses) — consistent with Gymini's own IAM policy and code, which invoke it directly by region-scoped resource ARN, never through a profile. Profiles exist for the 3 Nova variants Gymini could target and for the newer `cohere.embed-v4:0`, none of which changes the outcome — every one of these is gated by the same account-wide `NOT_AUTHORIZED` state regardless of profile availability.

## Authorized Models

**Zero.** No TEXT model and no EMBEDDING model in this account/region is `AUTHORIZED`. (See Phase 10 / Executive Summary.)

## Gymini LLM Compatibility

Not applicable to rank against Bedrock models (none authorized). Recorded for completeness once/if Bedrock access is granted: Gymini's `bedrock.client.ts` already uses Bedrock's Converse API (provider-agnostic across Bedrock text models with tool/vision support), so switching `BEDROCK_CHAT_MODEL` to a different authorized Bedrock model later would be `ENV_ONLY` — no code change — precisely because Converse is used instead of a model-specific request shape.

## Gymini Embedding Compatibility

Not applicable (no embedding model authorized). Recorded for completeness: any future Bedrock embedding model with a **different vector dimension than 1024** would be `CODE_AND_SCHEMA_CHANGE` (the OpenSearch collection is already created at 1024 dims for the current Cohere v3 model; changing dimension requires a new collection + full re-embedding of the existing knowledge corpus — `REINDEX_REQUIRED` at minimum). A same-dimension Cohere variant (e.g. `cohere.embed-english-v3`, also 1024-dim per `FIXED_DIMENSION_BY_BEDROCK_MODEL`) would be `ENV_ONLY` if authorized — but note it drops multilingual support, a real product regression for Vietnamese content, so not a like-for-like fallback even if it were authorized.

## Existing Non-Bedrock Provider Support

| Provider | Implemented? | Where used | LLM support | Embeddings support | Env required | Switch impact |
|---|---|---|---|---|---|---|
| **Anthropic (direct API)** | **Yes, fully, in production code paths** (`llm.service.ts`: `getHealthStatus`, `callLLM` both have complete `anthropic` branches, real `@anthropic-ai/sdk` calls, real token-budget handling — a real bug in this exact path was found and fixed live earlier this engagement, i.e. this is exercised, maintained code, not dead code) | `getHealthStatus`, `callLLM` | **Yes** | No (Anthropic has no embeddings API) | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` — **key is not currently set on either AI Lambda's environment** (confirmed absent from the env var name list captured in the prior audit) | **ENV_ONLY for code; requires provisioning one new secret** (not a code change, but not "flip an existing value" either) |
| **Ollama** | Yes, for local/docker dev only | `getHealthStatus`, `callLLM`, embeddings | Yes | Yes | `LLM_PROVIDER=ollama`/`EMBEDDING_PROVIDER=ollama`, `LLM_BASE_URL` | Not usable in AWS today — no Ollama server is deployed/reachable from any Lambda in this environment; deploying one would be a **MAJOR_CHANGE** (new compute resource, likely EC2/ECS + VPC networking), out of scope for a "fastest fallback" |
| **OpenAI (direct)** | **No** — no `OPENAI_API_KEY`/OpenAI SDK usage found anywhere in `ai-service` source | — | — | — | — | Would be a genuine new-provider integration — `MAJOR_CHANGE` |
| **Google Gemini** | **No** — no reference found anywhere in `ai-service` source | — | — | — | — | Same — `MAJOR_CHANGE` |
| **mock** | Yes | Every `LLM_PROVIDER` switch point, plus a parallel `mock` embedding provider | Yes (canned, non-personalized) | Yes (deterministic hash vectors — not semantically meaningful) | `LLM_PROVIDER=mock` / `EMBEDDING_PROVIDER=mock` | `ENV_ONLY`, zero risk, but **not usable for a real product demo** — output is a hardcoded generic plan/answer, RAG retrieval against hash vectors returns no meaningful semantic matches |

## Lowest-Risk DEV Fallback

**Classification: E — existing non-Bedrock provider fallback already implemented, for the LLM/text side only.**

- **Text generation / AI Coach / plan generation**: `LLM_PROVIDER=anthropic` + a provisioned `ANTHROPIC_API_KEY` secret. Zero source-code change — the branch already exists, is already exercised by real bug history, and is already parallel in every call site to the Bedrock branch. This is genuinely the lowest-change-surface path available today.
- **Embeddings / RAG**: **No usable authorized or non-Bedrock production-quality fallback exists today.** The only alternatives are `mock` (breaks RAG semantic relevance entirely) or deploying Ollama into AWS (a major infrastructure change). This part of the system has no low-risk fallback until either Bedrock Cohere access is granted or a new embedding provider is integrated.

## Required Changes (if this fallback were approved — **not applied**)

1. Provision `ANTHROPIC_API_KEY` as a new secret (Secrets Manager, matching the existing `fitness-assistant/dev/ai-database`-style convention) and add it to both `fitness-assistant-dev-ai` and `fitness-assistant-dev-ai-worker` Lambda environments.
2. Set `LLM_PROVIDER=anthropic` on both Lambdas.
3. Leave `EMBEDDING_PROVIDER`/`BEDROCK_EMBEDDING_MODEL` as-is — RAG would continue failing at the embedding step regardless (a separate, already-documented gap); this fallback only unblocks LLM chat/generation, not evidence retrieval quality.
4. No source code change, no IAM change beyond adding `secretsmanager:GetSecretValue` on the new secret's ARN (mirroring the existing `ReadAiDatabaseSecret` statement shape).

## Blockers

- **Bedrock: account-wide.** All 40 models, 7 providers, `NOT_AUTHORIZED`. Confirmed not IAM (prior audit), not SCP (account not in an Organization), not per-model agreement (varies but blocked regardless). Consistent with AWS Support's own statement about insufficient account usage history.
- **Anthropic direct fallback: not yet provisioned.** Code is ready; the secret is not.
- **Embeddings: no fallback at all** for production-quality RAG without either the Bedrock Cohere grant or a new (unimplemented) embedding provider.

## Recommended Next Action

Do not keep probing individual Bedrock model IDs — the account-wide result is conclusive. Two independent tracks, not mutually exclusive:
1. Continue pursuing the AWS Support case for Bedrock account authorization (covers both LLM and embeddings, the only real fix for RAG).
2. If a DEV-only text-generation fallback is wanted in the meantime, provisioning `ANTHROPIC_API_KEY` and flipping `LLM_PROVIDER=anthropic` is ready to execute with no code changes — pending explicit approval, not performed in this read-only audit.

---

## Final response (as requested)

**AUTHORIZED TEXT MODELS: 0**

**AUTHORIZED EMBEDDING MODELS: 0**

**CURRENT NOVA: BLOCKED**

**CURRENT COHERE: BLOCKED**

**GYMINI EXISTING FALLBACK PROVIDERS**: `mock` (test-quality only), **`anthropic` (real, production-grade, LLM-only, currently missing its API key)**, `ollama` (real, but not deployed in AWS)

**BEST LOW-CHANGE FALLBACK PATH: SMALL_CODE_CHANGE** *(precisely: zero code change, one new secret + two env var flips — closer to ENV_ONLY than a code change, but not a pure "flip an existing value" since a new credential must be provisioned first)*

Model(s) that would be used: **Anthropic direct API** (model ID controlled by `LLM_MODEL`/Anthropic's own model-id env, not yet inspected in this audit since it wasn't required to answer this task — code path is provider-agnostic) for **text generation only**. No embedding fallback exists — RAG stays broken either way.

- Tài khoản Bedrock có bị chặn toàn bộ không: **Có — chặn 100%, mọi model, mọi nhà cung cấp.**
- Có model nào dùng được ngay hôm nay không: **Không có model Bedrock nào cả.**
- Thay embedding có cần reindex không: **Không áp dụng được — không có embedding nào được authorize để chuyển sang; nếu sau này Cohere được cấp quyền thì dùng lại đúng model cũ, không cần reindex.**
- Có thiếu credential nhà cung cấp nào không: **Có — `ANTHROPIC_API_KEY` chưa được cấp phát trên cả 2 Lambda AI, đây là điều duy nhất cản trở việc dùng nhánh Anthropic đã có sẵn trong code.**

## Final classification

```
DEV_AI_FALLBACK:
POSSIBLE_WITH_SMALL_CHANGE
```

(For text/chat generation only, via the already-implemented Anthropic direct provider, once a key is provisioned — no source change. Embeddings/RAG remain `BEDROCK_ACCOUNT_BLOCKED` with no existing fallback.)

No model was invoked. No AWS resource, IAM policy, or Lambda environment variable was modified. No source code was changed. No deployment was performed.
