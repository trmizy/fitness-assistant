# E3 Nova Pro LIVE Converse transport (code ready, execution locked)

2026-11-04 · branch `feat/e3-nova-measured` on top of `b73841ff` · **E3_NOVA_LIVE_TRANSPORT_CODE_READY_EXECUTION_BLOCKED**. Evidence: **TEST FIXTURE / CODE AUDIT** with a mocked SDK `send`. No AWS request, credential resolution, trust root, signature or ledger was created.

Account facts used (read-only, owner-authorized, 2026-11-04):
- **Account:** `divuzha` / `730323515543`.
- **Model status:** Nova Pro in `us-east-1` is `ACTIVE`, `ON_DEMAND`, `AVAILABLE`/`AUTHORIZED`.
- **Quotas:** 25 RPM, 1M TPM.
- **Public price:** Standard 0.80 / 3.20 USD per 1M input/output tokens.
- **Logging and retention:** no invocation logging, no CloudTrail trail, retention `inherit`.
- **Owner decision:** keep invocation logging off for this synthetic warmup and rely on local receipts and journals.

## Implementation

- **`nova-live-transport.ts`**
  - Dedicated `BedrockRuntimeClient` fixed to `us-east-1`, credentials from `defaultProvider({ profile: "divuzha" })` (an explicit profile skips environment keys), `maxAttempts: 1`. It sends `ConverseCommand` only.
  - SDK errors become typed failures from the HTTP status: 403 is authorization, 429 throttled, 400 validation, 5xx provider. They are not retried, and error text is bounded to 500 characters.
  - A failure with no HTTP status is `NOVA_NETWORK_UNKNOWN_OUTCOME` with unknown usage, which stops the session and keeps the reservation. An abort is rethrown as an abort.
  - No `process.env` access.
- **Shared validation:** `createNovaTransport` validates responses identically for the FAKE and LIVE IO (strict text-only content, strict usage, nonzero cache fields fail closed, `totalTokens` consistency, measure output ≤ 1, inference stop must be `end_turn`).
- **Session order for Nova LIVE:**
  1. Signed configuration (`parseConfiguration`: opt-in, profile confirmation, `OWNER_CONFIRMED_AWS` pricing, approval `configHash` and expiry).
  2. Pinned inputs and a clean checkout (`assertVerifiedPins`).
  3. Installed trust root and signature (`installedApproval`).
  4. Read-only issued-ledger pre-check (`assertIssuedLedger`: an unused `OWNER_SIGNED` issue bound to the approval and config, with no lock or write).
  5. **`NOVA_LIVE_LOCKED`** (`NOVA_LIVE_EXECUTION_LOCKED = true`).

  The ledger claim and the LIVE transport construction come only after the lock. `RUNNER_LIVE_LOCKED` and `CLI_LIVE_LOCKED` are unchanged. Mantle LIVE stays locked at target resolution.
- **Config:** Nova LIVE parses only with the generic signed-approval conditions plus retries 0 and the claim registry source. FAKE still forbids opt-in, non-FAKE pricing and approvals. The caps are unchanged: 8 inference + 4 measurements, 12,000 input / 2,048 output per call, totals of 144,000 / 16,388, USD 1, 2 failures.
- **Unchanged:** measured-preflight reservation and reconciliation, exact input reconciliation, E2 full output, claimLinks, gate, provenance, receipts and raw/post-gate accounting.

## Payload preview (outside Git)

An owner-readable preview of the 4 unique prompts was generated file-only. It contains exact measure and inference request bytes, `tokenPayloadHash`, request SHA-256s and a label scan (no label keys, no label-hash values, no private sidecar). Measure and inference requests differ only in `inferenceConfig.maxTokens` (1 vs 2048). **Token parity on AWS is NOT_VERIFIED**; the session stops on any usage mismatch.

## Verification

- `ai-coach-nova-live-transport.test.ts`: **10 pass / 0 fail**. Covers client pinning, exact measure/inference payloads, SDK error mapping without retry, abort, fail-closed replies, signed-config parsing, the pins gate before anything, no injected LIVE transport, runner lock, source order of gates → lock → claim → transport, trust root required, and the read-only ledger pre-check.
- The `ai-coach-nova-measured-transport` suite was updated for the moved lock: 11 pass.
- Related regression (23 files): **229 tests, 226 pass, 0 fail, 3 skipped**. The skips are the Frozen V2 artifact checks, whose ignored artifacts are absent in this worktree. Not full repository regression.
- `pnpm exec tsc --noEmit` (ai-service): exit 0.

## Remaining before any AWS request

These are still missing:
- Owner payload approval.
- An explicitly authorized change that lifts the three locks for this protocol only.
- A LIVE configuration prepared on a clean checkout whose `workspaceRoot` is the implementation worktree (private inputs in its ignored `artifacts/`, pins recomputed; any prompt-hash change needs re-review).
- `OWNER_CONFIRMED_AWS` pricing evidence.
- An owner-installed trust root, an Ed25519 approval and an `OWNER_SIGNED` ledger.
- Explicit authorization for 4 measurements + 8 inference calls.
- Recommended: an owner-created 1 USD AWS Budget alert (not a hard cap) and a dedicated least-privilege principal instead of the long-term admin key.
