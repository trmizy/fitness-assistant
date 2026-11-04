# E3 Nova warmup — two-phase LIVE (measure-only, then owner-released inference)

Owner decision: `E3_NOVA_V4_1_TWO_PHASE_OPTION_A_APPROVED_FOR_OFFLINE_IMPLEMENTATION`.

This is offline implementation only. It grants no AWS authority. Payload bytes are unchanged: `CLAIM_PROMPT_V4_1`, the same 4 token payloads and request SHAs. The code and config identity change, so the owner must confirm the new pins/configHash and sign a new config.

Nova Pro has no CountTokens API. A "measurement" is a billed Converse call with `maxTokens=1`; the count is the AWS-reported `usage.inputTokens` (E20).

## State machine

A two-phase scope is a signed config field, `novaScope.phases = "MEASURE_THEN_OWNER_RELEASE"`.
- It is LIVE-only (`NOVA_TWO_PHASE_LIVE_ONLY`).
- It is part of the ledger scope (`novaLedgerScope`), so the owner-issued ledger binds it.
- Absent means the historical one-shot run, byte-identical in config and ledger scope.

```
ISSUED ─(measure-only run)─▶ CLAIMED ─ 4× MEASURE_RESERVED/RECONCILED/COUNT_RECORDED ─▶ MEASUREMENT_PHASE_COMPLETED ─▶ (stop)
   owner reviews measurement-report.json, signs the inference release (owner key, next to the ledger)
MEASUREMENT_PHASE_COMPLETED ─(--resume + valid release)─▶ RESUMED ─ INFERENCE_RESERVED/USAGE_RECONCILED … ─▶ summary
```

| Step | Gate (`session.ts` / `runner.ts`) |
| --- | --- |
| First run of a two-phase config without `--measure-only` | refused before the ledger is claimed: `TWO_PHASE_STARTS_WITH_MEASURE_ONLY` |
| `--measure-only` on a one-shot config | refused before claim: `MEASURE_ONLY_REQUIRES_TWO_PHASE_SCOPE` |
| Measure-only | all owner gates as before; the 4 measurements (cap 12,000, billed reservation, reconciliation) run as before. Then `completeMeasurementPhase()` appends the ledger row `MEASUREMENT_PHASE_COMPLETED` (state with all counts, `countCalls = 4`, no inference) and the run writes `measurement-report.json` (create-only; digest-checked on repeat). No inference is reserved or sent; `attempt()` refuses in a measure-only session (`MEASURE_ONLY_SESSION`) |
| Repeat or crash-resume of measure-only | measured prompts come from the ledger (no re-send); the phase row is written once |
| Inference resume | **before** the ledger is resumed: the claimed issue must match binding and scope (`allowClaimed` only for two-phase resume), the measurement-phase row must exist, and the release file must verify |
| Under the ledger lock | the closing row and counts must still equal the release (`INFERENCE_RELEASE_MEASUREMENT_MISMATCH`); an unresolved billed measurement blocks (`UNRESOLVED_MEASUREMENT_REQUIRES_OWNER_AUDIT`) |
| Inference phase | never measures again (`MEASUREMENT_AFTER_RELEASE_FORBIDDEN`). Each attempt re-checks release expiry. Token parity, cache fail-closed, `maxFailures`, budget, attempt identities, the owner interleave and the 8-call cap are unchanged |

## Inference release (owner authorization for phase 2)

File: `<trust ledgerDirectory>/<approvalId>.inference-release.json`. It is written by the owner script, outside the run and workspace.

```
{ version: "nova-inference-release-v1", approvalId, approvalHash, configHash, issuer, releasedBy,
  measurementRecordHash, measuredCounts{promptHash: inputTokens}, expiresAt, signature }
```

`verifyInferenceRelease` checks, in order:
1. Ed25519 signature over the canonical body, using the installed trust-root key and issuer.
2. approvalId, approvalHash and configHash.
3. The chained ledger-row hash of `MEASUREMENT_PHASE_COMPLETED`, and exact equality of the 4 counts.
4. Not expired, and not after the approval expiry.

A chat message or a log line is not an authorization; only this signed file admits inference.

## Unchanged

- One-shot LIVE: an unused issue is still required, and a used approval still cannot be resumed (`APPROVAL_ALREADY_USED`).
- Payloads, prompt V4.1, the schema, the verifier and gates, the interleave, the failure counting and stop rules.
- Frozen V2.

## Tests

`ai-coach-nova-two-phase.test.ts` (TEST FIXTURE rehearsal: fixture keys, FAKE_TEST_ONLY ledger, fixture send). It covers:
- measure-only: 4 sends, 0 inference, a durable phase row and report, idempotent repeat;
- no release: refused before resume;
- a release from another key: refused end-to-end;
- a valid release: 8 inferences in the owner order, 0 re-measurements, one ledger, repeat resume returns the stored summary, a different run directory is refused;
- `--measure-only` on a one-shot scope: refused;
- release verification: key, issuer, counts, row, approval, config, expiry, lifetime, shape;
- crash mid-measurement and crash mid-inference: no duplicates;
- measurement > 12,000: fail closed;
- token parity mismatch: stop;
- two failures: stop, and resume sends nothing;
- budget below the reservation;
- approval expiry;
- one-shot behaviour unchanged.

These rehearsal tests need a clean checkout, because LIVE pins are re-verified before every send.
