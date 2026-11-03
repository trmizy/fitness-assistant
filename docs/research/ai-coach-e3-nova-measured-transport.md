# E3 Nova Pro Converse transport with measured preflight (FAKE only)

2026-11-04 · branch `feat/e3-nova-measured` from `f3a2e4dc` · **E3_NOVA_FAKE_READY_LIVE_BLOCKED**. Evidence: **TEST FIXTURE / CODE AUDIT**. No AWS, Converse, CountTokens or credential resolution occurred in this change.

## Why

`GET /v1/models/anthropic.claude-haiku-4-5` on `bedrock-mantle` us-east-2 returned `status: unavailable` for both local AWS accounts (REAL HTTP/API, 2026-11-03/04), so the Mantle target cannot run until AWS enables it. The owner chose Nova and delegated the design. No route with a documented exact counter exists on `bedrock-runtime`. [Nova Pro](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html) lists Count tokens and Structured outputs as not supported. CRIS-only Claude models cannot use runtime CountTokens ([count tokens](https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html)). No official Nova tokenizer is published, and the third-party counters found use cl100k estimates, so none is used.

## Design

- Target: `bedrock-runtime` Converse, `amazon.nova-pro-v1:0` bare ID, `us-east-1` (In-Region per the model card), no inference profile.
- **Measured preflight:** the transport `count()` sends the exact inference request with only `inferenceConfig.maxTokens` set to 1. It returns AWS-reported `usage.inputTokens`, and that number is the count. One measurement is taken per unique prompt (4 for the warmup; repeats reuse it). A measurement over 12,000 stops before any inference.
- **Exact reconciliation (unchanged session rule):** inference `usage.inputTokens` must equal the measured count, otherwise the run stops with the conservative reservation retained.
- **Prompt caching:** the adapter never sends `cachePoint`. AWS documents that Nova implicit cache reuse is not reported in the cache usage fields and is not billed as cache reads ([prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)). Nonzero `cacheRead/WriteInputTokens` therefore fail closed.
- **Billed count accounting:** a transport declaring `billedCount` makes the session reserve the per-call input cap plus 1 output token before dispatch. It then reconciles to the reported usage, which may exceed the reservation and is recorded as is. A measure reply with unknown usage keeps the reservation and stops.
- **Caps** (`NOVA_CONVERSE_MEASURED`, FAKE only): 8 inference + at most 4 measurements; 12,000 input and 2,048 output per call; totals of 144,000 input and 16,388 output tokens; USD 1; retries 0; stop at 2 failures; 2 arms × 2 repeats, MINIMAL, CLAIM_MAP_V3, OWNER_ONLY_EXPLORATORY.
- The preview reports `measuredPreflight` and includes it in the token/USD ceilings.
- **Responses:** non-`end_turn` stops (truncation, guardrail, filter, tool use) are failures. The full provider envelope is retained and redacted as on the Mantle path. E2 schema, claimLinks, gate and R1 receipts are unchanged. Structured output still relies on prompt instructions plus strict local schema validation.
- **Locks:** `inferenceTarget` throws `NOVA_LIVE_LOCKED` outside FAKE. Config rejects LIVE/opt-in, other model/Region/profile, cap increases and non-FAKE pricing. The session requires the configured protocol, the transport protocol and the `billedCount` declaration to match. There is no LIVE Nova transport in this change.

The owner decision is recorded outside Git as a delegated supplement (`e3-owner-decisions-nova-route.json`). It changes E13, E20 and E15 and carries zero execution authorization. The original stores are unchanged.

## Verification

- `ai-coach-nova-measured-transport.test.ts`: **11 pass / 0 fail**. Covers payload parity (only `maxTokens` differs), unsupported inputs, FAKE-only IO, abort, measure/usage/cache/HTTP failures without retry, stop reasons, config/transport locks, reservation and reconciliation, over-cap measurement, pre-dispatch budget, usage mismatch, and a runner run with 4 measurements + 8 calls and an idempotent resume.
- Related regression (22 files: the earlier 21 plus this suite): **219 tests, 216 pass, 0 fail, 3 skipped**. The skips are the Frozen V2 artifact checks; those ignored artifacts are absent in this worktree. Not full repository regression.
- `pnpm exec tsc --noEmit` (ai-service): exit 0.

## Remaining before any real call

These are still needed:
- A LIVE Nova Converse transport, which needs a separately authorized change.
- Nova Pro us-east-1 pricing re-verified as `OWNER_CONFIRMED_AWS`.
- Account checks for `divuzha` in us-east-1 (model availability, quotas, logging/retention).
- Owner payload review.
- Owner trust root, an Ed25519 approval and an `OWNER_SIGNED` ledger.
- Explicit owner authorization for the 4 billed measurements and the 8 inference calls.

Two points remain NOT_VERIFIED on AWS:
- that measured and inference input usage are equal for identical token-bearing payloads (the session stops if they differ);
- Nova Pro's Vietnamese and JSON-contract quality.
