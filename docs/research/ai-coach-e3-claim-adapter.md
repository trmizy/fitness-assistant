# E3 — Claim-grounded pilot adapter

2026-11-03. Branch `feat/advisory-content-v3`, implementation base HEAD `473b135e`. Evidence: **CODE AUDIT / TEST FIXTURE**. Final closeout and technical warmup checklist: [controlled warmup readiness](ai-coach-e3-warmup-readiness.md). This work connects E2 to the existing D1/D2/D3/Bedrock FAKE runner; it does not introduce a second runner, analyzer, dashboard or production route.

## Scope implemented

- `bedrock-pilot/config.ts`: additive `outputContract=CLAIM_MAP_V3`, external claim-registry config, optional protocol-decisions input, owner-only review mode, and the selected Haiku4.5 identifier for FAKE simulation. E2 sources and output contract must agree. Legacy config/hash behavior is retained when optional fields are absent.
- `prepare.ts` / `claim-adapter.ts`: the two selected arms reuse E2 context/prompt and exact E1-bound excerpts. Both receive the same personal facts, provenance, product policies and system policy. `LAYERED_CONTEXT` supplies no scientific knowledge; `LAYERED_CONTEXT_RAG` supplies at most **two ranked approved claims** under the bounded warmup policy. Only MINIMAL and those two arms are accepted in this slice. Source-level reviewer context preserves every selected claim's population, applicability, evidence limitations and unsupported inferences, including multiple claims sharing one source. This does not change the existing E2 DEV slice's default retrieval or its historical results.
- `pins.ts`: E2 corpus identity binds config, input bundle, claim map, current owner file and protocol-decisions bytes. Executing TS files, including new FAKE development files, are hashed. Stale owner decisions or later map/code/protocol changes fail admission/recheck. The E2 path does not read the legacy V2 corpus or invoke legacy embedding/search IO.
- `session.ts`: contract-aware strict parsing before and after redaction. A missing/malformed `claimLinks` field is a parse failure, never an automatic legacy downgrade. Complete canonical E2 output and raw-response representation receipts remain in the existing append-only journal. Secret-bearing text is redacted; no plaintext secret archive is added.
- `ai-coach-claim-dev/projection.ts`: explicit versioned legacy view with full-candidate, projected-view and claimLinks hashes. It never strips fields from the stored full candidate.
- D1 `annotationUnits`: E2 answers become claim/conclusion/question units before sealing. Packet `candidateHash` still binds the full E2 envelope, not only the legacy projection. Existing receipt V2 and redaction/reseal checks remain. A changed link changes full identity and cannot reuse an old packet.
- `runner.ts`: reuse E2 verification and preserve diagnostics/unknown support/raw/post-gate outcomes; grounding makes no additional generation call. Same-case evidence pools are identical across generation arms. Owner-only mode exports R1 only. The internal R2 receipt slot required by the existing packet contract is retained without distributing an R2 file, creating a second reviewer, or inventing annotations.
- D3/lifecycle: strict E2-to-legacy projection at parsing boundaries; raw-candidate hashing remains full-envelope. No change to gate confusion eligibility, failure accounting, metric denominators, Cohen's κ, paired comparison or bootstrap algorithms.

No core advisory-progress/frozen V2 source or scientific source bytes were edited. Shared `ai-coach-dev` retrieval/verification changes are type-only parameter narrowing to the passages those helpers actually consume; the E2 path uses its own claim verifier.

## Data and current owner decisions

E13–E18 retain the choices recorded under explicit owner delegation: Haiku4.5 Global/Ohio direction; warmup8 with a USD1 cap and failure threshold2; a future exploratory20-case phase with a proposed USD5 cap after warmup review; synthetic AI-authored data with actual owner review; one real owner reviewer; readiness requirements without LIVE authorization. E12/C22 remains evidence-pending.

The historical registry config correctly refused the current owner file with `StaleOwnerDecisionsPin`: owner decisions had moved from revision7 to revision18. No historical hash/config/map was overwritten or relaxed. A **new local versioned offline snapshot** was derived using the unchanged builder/validator and the latest owner file. Only C01's accepted wording changed, exactly to the original text selected by the owner's latest APPROVE. All non-owner input snapshots and scientific evidence bytes stayed identical. This is current-owner provenance, not new independent scientific validation.

The snapshot is local ignored data under `artifacts/ai-coach-e3-adapter/2026-11-03/current-offline-snapshot/`. It has its own registry config and source hashes; the old registry still fails against the changed current owner file as expected. Context/RAG eligible counts are33/30, and C22 remains held. Nothing was copied over the untracked review deliverables or owner decision stores.

Warmup input uses **CAL01 and CAL06**, both actually ACCEPTed and routed NORMAL at snapshot time: two arms ×two repeats =8 scheduled calls. These are existing AI-authored owner-accepted calibration cases, not independent held-out or gold labels. Generation bundles allowlist only requests, manifests and actual owner-record receipt hashes. Label/author hashes describe calibration provenance without fabricating an independence attestation or creating a `ReviewerCaseSchema` gold file. Proposed labels never enter generation. Formal independent D3 analysis of these cases is not authorized by their calibration status.

## Budget and execution boundary

CLI and runner remain **FAKE_ONLY**. The new Haiku/E2 LIVE path explicitly rejects with `CLAIM_PILOT_LIVE_NOT_READY`; the existing profile-counting prohibition remains. No CountTokens/inference/AWS-account request, Ollama, embedding or production vector operation was performed. Simulated fixture ledgers are not owner-issued spend authorization.

The first actual-input FAKE preflight stopped before inference: six scientific claims in CAL01 produced approximately17,725 fake tokens, above the unchanged12,000 per-call cap. This is the CPU byte-based FAKE estimator, not model token measurement. The final warmup policy selects two ranked claims with complete scope/excerpts; the size probe estimated9,464 fake tokens for CAL01 RAG and6,583 for CAL06 RAG. No cap is raised, personal facts are not removed, evidence text is not truncated, and the failed run/journal is retained. These are not actual Haiku token counts and the two-claim limit is not evidence of adequate scientific recall.

Before actual Bedrock calls remain: exact Haiku model/profile counting compatibility, account access/quotas/IAM, confirmed current route pricing/expiry, retention/residency/logging review, clean/pinned implementation, and real installed trust/signature/issued ledger. No trust root, credential, approval signature or LIVE budget authority was created. Dashboard choices and caller-owned registry hashes do not replace those requirements.

## Verification

- Scoped regression: **393 pass / 0 fail / 0 skip / 0 cancelled**, 38 files. This run preceded the final two-claim warmup bound. After that isolated adapter-policy change, all **7 adapter tests passed again** on the final code; these are the same seven tests, not seven additional unique tests. Logs: `artifacts/ai-coach-e3-adapter/2026-11-03/{final-regression,bounded-adapter-tests}.log`.
- Final-code AI-service `pnpm exec tsc --noEmit`: **exit 0** (`tsc-final.log`).
- Existing CLI with actual CAL01/CAL06 inputs and FAKE transport: **8 scheduled / 8 finished / 0 failed / 8 blocked / 0 released**. The default scripted transport emits no personal observations, so all eight fail the personal-fact gate. This is plumbing evidence, not model failure, scientific correctness, or a successful advisory answer. Raw responses and diagnostics remain available in the ignored `bounded-fake-warmup-run/` directory.
- Export verification: **8 full E2 envelopes and R1 receipts verified**, 8 R1 exports, 0 R2 exports; same-case evidence pools match across arms. Results: `warmup-verification.json`. No annotations were invented, and scientific pass remains `null`.
- Real Bedrock/model, embedding and vector DB calls: **0**. Real-model quality is **NOT_MEASURED**; semantic support and personal applicability remain unknown.
- Protected before/after manifest: **69 files unchanged**, including scientific review/audit inputs and both decision stores. Frozen V2 integrity controls ran without skips. Evidence-pack SHA256 remains `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`; frozen results remain `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`.

No model quality or scientific support score can be inferred from scripted transport results. The results above describe the adapter implementation run; final-code scoped rerun and selective-commit disposition are recorded in the closeout document linked above. No merge is authorized.

Regression scope: all12 `advisory-*.test.ts`, all19 `ai-coach-*.test.ts` including the new E2 pilot suite, `scientific-claim-map-v3.test.ts`, four existing RAG suites (`rag-retrieval-v2`, `rag-remediation-4-7r`, `rag-ood-safety-4-7r2`, `rag-safety-signals-4-7r3`), and both Bedrock suites (`bedrock-provider`, `bedrock-cross-account`). Total38 test files. This is scoped regression, not full repository regression.

```powershell
# cwd: backend/services/ai-service
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$advisory=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$coach=@(rg --files src/__tests__ -g 'ai-coach-*.test.ts')
pnpm exec tsx --test @advisory @coach `
  src/__tests__/scientific-claim-map-v3.test.ts `
  src/__tests__/rag-retrieval-v2.test.ts `
  src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts `
  src/__tests__/rag-safety-signals-4-7r3.test.ts `
  src/__tests__/bedrock-provider.test.ts src/__tests__/bedrock-cross-account.test.ts
pnpm exec tsc --noEmit
```

New regression cases cover shared policy/fact parity, exact excerpts and all applicability fields, eight FAKE calls with full links, R1-only distribution, receipt-bound D1/D3 projection, completed resume with zero extra generation, missing link contract failures and failure cap, wrong link blocking, code/corpus/current-owner/protocol drift, LIVE rejection, secret redaction and tamper/missing-receipt rejection. Existing D1/D2/D3/frozen controls remain in the scoped run.

## Remaining limitations

FAKE counters/usage/prices/latency are fixtures, not measured Bedrock telemetry. CPU concept/lexical retrieval and canonical identity are not semantic support. Source support, personal applicability and real-model quality remain unmeasured/unknown. Owner-only review is `EXPLORATORY_OWNER_REVIEWED`; no fake R2, independent κ/CI or formal paired inference is produced. The existing role-based personal-claim denominator still needs all-text human review for mislabeled personal statements; it is not silently expanded here.

The snapshot is private/untracked and not a corpus production release. Full output schema retention is compatible with mandatory redaction; it does not mean secrets are archived verbatim. Pattern redaction still has its documented limitations. The separately authorized closeout permits a selective adapter commit; production integration, merge and additional framework work remain outside scope.
