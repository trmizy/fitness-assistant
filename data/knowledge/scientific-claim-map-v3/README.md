# Scientific Claim Map V3 — E1

Evidence: **CODE AUDIT / TEST FIXTURE**, prepared 2026-11-02 at baseline `718a00405e06a1ca5f7e9d6485ce14aae60a967d`. DEV/offline only. Owner-developer approval and assistant excerpt matching do not constitute independent scientific validation or production admission.

## Files and authority

| File | Purpose |
| --- | --- |
| `claim-map.json` | Generated map: exact owner text, owner record, separate AI proposals, evidence passages, applicability, limitations, prohibited inferences and hashes |
| `input-bundle.json` | Pinned original UTF-8 inputs with origin paths and SHA256; includes current local decisions, review/follow-up, calibration, dashboard definitions, audit source references, code and source captures |
| `source-snapshots.json` | 22 abstract records plus the ACSM 2026 open full-text capture; retains primary-source titles/URLs, capture scope, payload/body hashes and full-text license attribution |
| `bindings.json` | Explicit implementer-authored claim-to-passage bindings, additional scope and evidence holds; not an owner decision or semantic validator |
| `dashboard-items.json` | Import-ready engineering catalog fragment containing E12/C22, with `ownerDecision: null`, plus references to existing unresolved items |

Primary owner source: `C:/D_Backup/project_personal/gymini-review-local/scientific-review-decisions.json`, revision **7**, updated **2026-11-02T13:28:43.459Z**, SHA256 `9cb81c776a1f9080b8c1d1dea46f882a6c942a6bbb272726641237c8e38811d2`. The older worktree owner export was not used to overwrite this file or infer current decisions.

## Admission and counts

33 owner claim records yield **35 atomic rows** after exact newline segmentation of C32. **34 are admitted for DEV/offline**, one is held for evidence (C22); there are currently no rejected or undecided claim rows. Rejected/undecided states are implemented and regression-tested.

- 31 scientific rows are admitted, including C18 as `REVIEW_CONTEXT_ONLY`. `listForRag()` exposes the other **30**.
- Three admitted rows are product definitions/policies: C20, C23, C24. They are excluded from scientific RAG and included with the 30 scientific rows in `listForContext()` (**33**).
- C22 retains its accepted owner text and `OWNER_ACCEPTED`, but is `HELD_EVIDENCE` and unavailable from all registry accessors. Its missing direct excerpt/binding is not silently supplied by code or by related group studies.
- All 17 article decisions are recorded separately and confer no claim approval. A13 remains `REVISE_OR_VERIFY_ORIGINAL`; no A13-1/2/3 claims are generated.

`APPROVE` retains original `textVi` byte for byte as a string; `REVISE` requires the exact nonempty `acceptedRevisionVi`. Missing owner acceptance or missing/mismatched evidence prevents admission. C32a/b/c retain their labels and each has exact offsets into the unchanged parent accepted text. The old C32 narrative excerpt is not used for the revised claims.

## Important scope

- C01 uses the latest structured `REVISE` and accepted revision, with both the 2009 and 2026 supporting passages. Its older note mentioning APPROVE is preserved as provenance, not used to replace the structured decision.
- C21 preserves the owner's own wording, rather than the AI rewrite. The 5–10-repetition evidence is limited to the tested exercises/populations. No Gymini/Vietnamese validation was supplied in these inputs: this local documentation status is explicitly distinguished from a systematic literature-absence claim. The sources do not establish Epley versus Brzycki accuracy or a fixed Gymini error percentage.
- C32a/b/c use the follow-up sources for volume, tempo and effort separately. Whole-repetition duration is distinguished from ECC/CON phase duration; RIR 2–3 is not a universal prescription. The old narrative scope/certainty remains historical provenance, not the new evidence's grade.
- C31 remains male, cross-sectional evidence. The owner's request for female research is retained; no female applicability is invented.
- The original reviewed conditions, certainty and prohibited inferences remain in the map. Referenced conditions such as “Như C06” are expanded alongside their original text.
- CAL02 is **REVISE**, with no revised answer or threshold. CAL03 is **ACCEPT**, with `ownerAssessment: null`; no assessment or independent gold label is inferred. Calibration decisions are recorded separately from claim admission.

## Validation and reproduction

From `backend/services/ai-service`:

```powershell
pnpm exec tsx src/knowledge/scientific-claim-map-v3/run.ts --validate
pnpm exec tsx --test src/__tests__/scientific-claim-map-v3.test.ts
pnpm exec tsc --noEmit
```

`--build` reconstructs the map from the pinned bundle and writes only when `claim-map.json` does not exist; it refuses an overwrite. Validation rebuilds the expected complete map. Changing approved wording, limits, decision provenance or citations is rejected. Hash diagnostics identify the affected input/claim/source. Original paths are checked if available; unavailable originals are explicitly reported as pinned offline snapshots, never current live evidence. No application service/provider is imported.

There are **71 supporting references**: 66 literal matches and five typography/whitespace/case-normalized matches. Each stores the original reviewed `quote` and the actual `capturedQuote`; normalized matches are not called byte-exact. SHA256 binds captured text/input bytes, not an independently authenticated PDF or proof of scientific entailment. Transport payload hashes are provenance; captured body and input hashes are the locally recomputable checks.

The original capture helper at `scripts/scientific-claim-map-v3/capture-sources.cjs` made only public literature GET requests; existing full-text attribution/license is retained. It refuses to replace an existing capture before making requests. Regular build/validation/tests are fully offline.

## E2 DEV interface

`src/knowledge/scientific-claim-map-v3/registry.ts` exports `createClaimRegistry(input, map, trustedPins)` with `get`, `listForContext`, `listForRag`, and `resolveForGrounding`. Every record includes exact accepted text, exact supporting passages, population/scope, limitations and owner/source provenance. Held/pending/rejected IDs cannot be resolved for grounding. Returned records are isolated copies.

The caller must supply trusted bundle and current owner-decision pins obtained independently of an incoming packet; self-reported hashes do not establish authenticity or current approval. Updating decisions or source/code bytes requires a new captured/versioned build, not editing approved text in place. Historical sourceRef/item hashes are preserved; known file references are checked, but the dashboard's itemHash algorithm is not reimplemented here.

For E2, use this seam to supply approved scientific records to the existing DEV retrieval/context pipeline and preserve complete scope through grounding. Keep product policies separate, carry claim IDs/version/hash in review packets, and return explicit absence when no admitted claim supports a question. No production route, embeddings, index, model adapter, calibration taxonomy or evaluation framework is added by E1.

## Dashboard handoff

E12 provides the C22 hold, exact candidate ultrasound/DXA excerpts, the limitation of those candidates, and two owner options. It is **prepared for loading**, not a recorded owner decision or already displayed dashboard item. Existing E01/E02/E03/E07 and A13 cover the other outstanding questions; no duplicate chat approval flow was created. E06 construction is authorized by the current E1 request; no additional approval to construct this map is required.

No dashboard server/catalog/decision file was changed: E11's receipt currently references the entire engineering catalog hash. An importer must preserve existing owner records and their historical source snapshots rather than rewriting receipts to match a modified catalog. This E1 delivery prepares the compatible data instead of invalidating E11's source reference.

See [E1 handoff](../../../docs/research/ai-coach-scientific-claim-map-v3-e1.md) for scoped test evidence and protected-file checks.
