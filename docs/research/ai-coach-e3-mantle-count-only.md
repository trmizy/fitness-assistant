# E3 Mantle COUNT-only SigV4 client and probe package

2026-11-03 · branch `feat/e3-mantle-count-only` from `d6d9fb10` · **E3_COUNT_ONLY_PROBE_BLOCKED** (account not verified; owner trust/approval/ledger absent). Evidence: **TEST FIXTURE / CODE AUDIT**. No AWS, CountTokens, inference, credential resolution or LIVE unlock occurred.

Continues Codex's uncommitted COUNT-only work from `feat/advisory-content-v3` (`count-only-probe.ts`, `mantle-count-client.ts`, its test, the `@smithy/signature-v4`/`@smithy/core` dependencies and the `installedApproval` type widening), copied byte-identically into a separate worktree; the original working tree was not modified.

## Target (owner decision)

AWS profile `divuzha`, `us-east-2`, `anthropic.claude-haiku-4-5`, Bedrock Mantle Anthropic Messages, SigV4 service `bedrock-mantle`, `POST https://bedrock-mantle.us-east-2.api.aws/anthropic/v1/messages/count_tokens`, header `anthropic-version: 2023-06-01`, project `default` (no `anthropic-workspace-id` header). Contracts: [AWS Mantle counting](https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html#count-tokens-mantle), [service authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-mantle.html), checked 2026-11-03.

## Implementation

- `count-only-probe.ts`: unsigned package `mantle-count-only-probe-v2`. Fixed profile/model/Region/service/endpoint; 1 request, retries 0, inference 0, input cap 12,000, timeout ≤30 s, validity ≤24 h. Body must be the exact canonical `serializeMantle` count body (`model`/`system`/`messages`; no `max_tokens`, sampling, tools, cache or media), its SHA-256 and prompt hash must match, structured label keys are rejected. Pins: data `commit`, `implementationCommit`, `code`, `corpus`, `cases`, `ownerAmendments`. Account readiness needs a 12-digit account in `project/default` Ohio, a matching principal ARN and ten checks (principal, project, modelAccess, marketplaceEula, effectiveIamScp, quotas, privacyRetentionLogging, billingProtection, credentials, payloadReview), each `VERIFIED` only with an evidence-file SHA-256 dated no later than preparation.
- `mantle-count-client.ts`: Smithy SigV4 signer (`us-east-2`/`bedrock-mantle`); one native HTTPS request to a hard-coded host/path, no redirects/proxy/retry, 64 KiB response cap, timeout abort. Typed outcomes: 400 validation, 401/403 authentication, 429 throttled, 3xx refused, other provider errors, invalid JSON/schema, `input_tokens` over cap. Receipts keep status, allowlisted headers and the redacted body; resolved credential values are scrubbed. A provider-reported `accountId` must equal the project account. The executor additionally requires a clean checkout at `implementationCommit`, the installed trust root, an owner-signed approval whose `configHash` is the package digest and whose expiry is not later than the package, and an owner-preissued `OWNER_SIGNED` ledger. It reserves the single count in the ledger before resolving credentials (`defaultProvider({ profile: "divuzha" })`, which skips environment keys), then records completion or failure.
- `count-only-cli.ts`: `prepare` (file-only; computes pins from the existing FAKE config, validates the E13/E19/E20 amendment store, hashes owner evidence files itself, writes the package create-only); `inspect` (file-only summary plus unsigned approval template); `execute` (the gated single request; writes `count-receipt.json` or `count-error.json`). No inference subcommand. The existing pilot CLI/runner LIVE locks are unchanged.

## Selected request

CAL01 (`case-warmup-cal01`, `dev-cal-01`), arm `LAYERED_CONTEXT`, policy `MINIMAL`, repeat 0. Prompt hash `166ae504ca883bb45c26a1e9a1bbaf131461e11554c4dfe5005bcf2c5a9bfcb6`, request hash `ceb23e26302d1d825ef65eb1a74cda63dbd54b75ba075d53fb08a55937c41169`.

- **Count body SHA-256 (exact serialized request body):** `051323a59efef236811213bbf18245b03aa63517415ce0ff3ffad0472bd76f93`, 11,103 bytes; equals `tokenPayloadHash`.
- Paired inference body (not authorized): `24ec34d8d6d5df8afb094380ab3b019daefec53476340d95936b70e2f74ee16f`; removing `max_tokens`/`temperature` yields the count body.

The source case is an assistant-drafted synthetic calibration case (`DRAFT_PROPOSAL_NOT_GOLD`); no user data. Case gold/proposed labels/reviewer notes/label hash are absent. The prompt does contain fixed policy metadata that the real warmup prompt also carries: owner-approved product-policy texts with provenance file hashes, and calibration/curation statuses (CAL02, CAL03, E07). It was not rewritten, because counting a different prompt would not validate the warmup input; `payloadReview` stays an explicit owner check.

The package digest (approval `configHash`) depends on `preparedAt`/`expiresAt`, the implementation commit and account evidence, so it is produced by `prepare` when the owner is ready, not fixed here.

## Verification

- `ai-coach-mantle-count-only.test.ts`: **20 pass / 0 fail**. Covers independent SigV4 recomputation, exact body/hash/identity parity, profile/target pinning, malformed/oversized counts, 400/401/403/429/5xx/3xx without retry or fallback, timeout and pre-abort, credential failure redaction, account-mismatch stop, evidence-backed readiness, clean pinned checkout, `OWNER_SIGNED`-only one-shot ledger, single fixed route with no Runtime/inference strings, CLI inspect/execute fail-closed before credentials, existing `CLI_LIVE_LOCKED`.
- Scoped related regression (21 files: the 19 from the FAKE transport report plus `ai-coach-mantle-transport` and this suite): **208 tests, 205 pass, 0 fail, 3 skipped**. The skips are the Frozen V2 artifact checks, whose ignored local artifacts do not exist in this new worktree. Not full repository regression.
- `pnpm exec tsc --noEmit` (ai-service): exit 0.

## Remaining blockers

Account verification for `divuzha` (none performed; read-only commands need owner permission), Marketplace/EULA decision, IAM/boundary/SCP and the unverified `bedrock-mantle:Model` value format, quotas, retention/logging, billing protection, owner payload review, the `divuzha` profile being a long-term access key (no session token), trust root `C:/ProgramData/Gymini/Evaluation/trust.json`, owner Ed25519 approval and `OWNER_SIGNED` ledger. A successful count would verify only that request/account/time; it authorizes no inference or warmup.
