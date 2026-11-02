# E1 — Scientific Claim Map V3 handoff

2026-11-02. Branch `feat/advisory-content-v3`; HEAD remains `718a00405e06a1ca5f7e9d6485ce14aae60a967d`. Evidence: **CODE AUDIT / TEST FIXTURE**, with read-only public literature retrieval for passage capture. No new independent audit, integration/cherry-pick, production admission or model evaluation.

## Result

The map consumes the authoritative local decisions, revision 7, updated `2026-11-02T13:28:43.459Z`. It has **35 atomic rows**, preserving the owner's exact text and original decision records:

| Disposition | Count | Boundary |
| --- | ---: | --- |
| Admitted scientific claims | 31 | 30 for DEV scientific RAG; C18 only for reviewer context |
| Admitted product definition/policies | 3 | C20/C23/C24; kept outside scientific RAG |
| Owner-accepted, held for evidence | 1 | C22; unavailable from the E2 registry |
| Rejected / pending owner claim rows | 0 / 0 | States and exclusion behavior are tested |

This is **34 DEV/offline admissions**, not 34 independently validated scientific claims. No claim authorizes a personal prescription or production ingestion. A13 and other article decisions never create approved claims automatically.

C21 uses the owner's revision and narrow study scope. C32 becomes C32a/b/c using exact substrings and revised volume/tempo/RIR sources; no old narrative evidence is substituted. C01's structured REVISE controls despite the older contradictory note, which is preserved. C31 is not extended to women. C22 remains held because no verified binding for the whole accepted measurement-inference wording is supplied; related ultrasound/DXA studies are prepared as candidates, not silently admitted evidence.

CAL02 remains REVISE with no revised answer/threshold. CAL03 remains ACCEPT with no explicit ownerAssessment. No draft label becomes independent evaluation gold or a new threshold/taxonomy.

## New files

- `data/knowledge/scientific-claim-map-v3/{claim-map,input-bundle,source-snapshots,bindings,dashboard-items}.json` and `README.md`.
- `backend/services/ai-service/src/knowledge/scientific-claim-map-v3/{schema,builder,registry,run}.ts`.
- `backend/services/ai-service/src/__tests__/scientific-claim-map-v3.test.ts`.
- `scripts/scientific-claim-map-v3/capture-sources.cjs`.
- This report. All files are new; no existing review document or owner decision was rewritten. No commit/merge was performed.

The map stores 71 supporting references: 66 literal and five explicitly normalized text matches, with exact captured passages retained. Hashes identify the captured source/input bytes. Matching is mechanical plus implementer-authored binding, not an automatic entailment/expert-review result.

## Validation evidence

The new 15 tests exercise owner-vs-AI authority, exact C21/C32 text, unapproved/rejected/missing-owner states, missing/unknown/mismatched sources, product-vs-science distinction, explicit source-hash failures, edited approved text or lost applicability/limitations, registry pins, article/claim separation and CAL02/CAL03. Validation reconstructs the complete map from pinned inputs and checks available originals; all 13 captured input origins matched their bytes at handoff.

Scoped regression: **20 files, 243 pass / 0 fail / 0 skip / 0 cancelled**: 12 advisory suites, three `ai-coach-dev` suites, the new claim-map suite and four existing CPU-fixture RAG suites. TypeScript `pnpm exec tsc --noEmit`: **exit 0**. This is not full repository regression or an independent scientific audit.

```powershell
# cwd: advisory-content-v3/backend/services/ai-service
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$advisoryTests=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$devTests=@(rg --files src/__tests__ -g 'ai-coach-dev*.test.ts')
pnpm exec tsx --test @advisoryTests @devTests `
  src/__tests__/scientific-claim-map-v3.test.ts `
  src/__tests__/rag-retrieval-v2.test.ts `
  src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts `
  src/__tests__/rag-safety-signals-4-7r3.test.ts
pnpm exec tsc --noEmit
pnpm exec tsx src/knowledge/scientific-claim-map-v3/run.ts --validate
```

Existing frozen V2 integrity tests run without skips. Manual hashes remain:

- Evidence pack: `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`.
- Frozen results: `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`.
- Current map input-bundle canonical hash: `fb97e98a1177439c05be05615dd9febcad59266a88b9661b294627c2c1ac1c0d`.
- Current owner-decision file SHA256: `9cb81c776a1f9080b8c1d1dea46f882a6c942a6bbb272726641237c8e38811d2`.

Protected-file comparison: **29/29** pre-existing untracked review/audit files and **26/26** local review/dashboard files unchanged, including every owner decision. Before/verification manifests are under ignored `artifacts/scientific-claim-map-v3/2026-11-02T13-55-41-163Z/`. Historical V2 sources/scores and scientific review bytes remain unchanged.

No Bedrock, Ollama, embedding or vector-DB calls. No DB/index/application flags/provider configuration/routes were changed. Literature capture used public read-only HTTP, not crawler/ingestion. Evaluation integrity work remains closed.

## Decisions and E2

`dashboard-items.json` prepares E12 for C22, with exact candidate excerpts and `ownerDecision: null`. It has not been loaded into the current dashboard catalog: the catalog's original bytes are referenced by E11's receipt. Prepared compatible data is the user-authorized alternative to changing that catalog. Existing A13 and E01/E02/E03/E07 remain the respective places for article verification, CAL03 taxonomy, CAL02 threshold, calibration revisions and formal additional-source curation. The current E1 request itself authorizes construction of this map.

E2 can reuse `createClaimRegistry` in the existing DEV Context/RAG pipeline: trusted current input/owner pins → admitted full claim records → scientific-only retrieval candidates → grounding by claim ID/version and exact excerpts while retaining applicability and limitations. C22/unapproved IDs fail resolution. C18 stays reviewer-only and product policies stay separate. Establish the dashboard import/current-owner pin handoff and resolve relevant owner items before promoting any source/claim to production. Real model quality, semantic entailment and independent scientific validation remain unmeasured.
