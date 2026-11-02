# E1/E2 closeout — implementation and private input boundary

2026-11-02, branch `feat/advisory-content-v3`, reviewed starting HEAD `718a00405e06a1ca5f7e9d6485ce14aae60a967d`. Evidence: **CODE AUDIT / TEST FIXTURE**, no independent re-audit or model evaluation.

E1's approved-claim builder/validator/registry and E2's Context/RAG/structured-analysis/V3-gate slice are ready for a selective implementation commit. Original E1/E2 reports remain historical and byte-identical, including their “not committed” statements at the time of those handoffs. This closeout records the subsequent commit operation; the resulting hash is in the final handoff and `git log`.

## Selective scope

Included: four `src/knowledge/scientific-claim-map-v3/*.ts` files; six `src/evaluation/ai-coach-claim-dev/*.ts` files; the E1 and E2 test files; the source-capture helper; public data README; E1/E2 handoff documents; this closeout and the public E3 proposal/collection/dashboard-import brief. No existing implementation was modified to broaden framework or open LIVE.

**Not committed:** all five E1 JSON input/data files under `data/knowledge/scientific-claim-map-v3/` (`input-bundle`, `claim-map`, `source-snapshots`, `bindings`, `dashboard-items`), all original scientific-review/calibration/audit untracked inputs, local owner decisions, reviewer identities, annotations/labels and runtime artifacts. `input-bundle.json` contains exact owner/calibration/audit snapshots; `claim-map.json` embeds owner records. They cannot be treated as a public synthetic fixture merely because they are under `data/`.

The private E1 packet remains present locally, unchanged and outside the commit. Consequently a clean clone of this implementation **requires separately provisioned private inputs to run the E1/E2 data-dependent suites**; it does not contain a redistributable scientific corpus/decision dataset. No automatic skip, synthetic replacement approval or weakened validation was introduced to hide that dependency. The aggregate verification below ran in the authorized worktree with those inputs and preserved frozen V2 artifacts supplied explicitly.

The worktree remains dirty from private/unrelated untracked material after the selective commit. This is intentional preservation, **not** evidence that the existing LIVE clean-tree requirement has been met. An authorized E3 must use a clean evaluation checkout with explicitly pinned external case/claim inputs via the planned E2 compatibility adapter; do not stash, clean, commit private inputs or bypass the guard to make it green.

## Verification actually run

**36 files, 372 pass / 0 fail / 0 skip / 0 cancelled.** Scope: 12 advisory suites, 17 `ai-coach-*` suites, E1's scientific-claim-map suite, two Bedrock transport suites and four RAG CPU-fixture suites. Includes D1/D2/D3, evaluation integrity/receipt downgrade/redaction, E1/E2, Bedrock FAKE transports and frozen V2. TypeScript `pnpm exec tsc --noEmit`: **exit 0**. This is the combined requested scope, not full monorepo regression.

```powershell
# cwd: advisory-content-v3/backend/services/ai-service
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$advisoryTests=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$coachTests=@(rg --files src/__tests__ -g 'ai-coach-*.test.ts')
pnpm exec tsx --test @advisoryTests @coachTests `
  src/__tests__/scientific-claim-map-v3.test.ts `
  src/__tests__/bedrock-provider.test.ts src/__tests__/bedrock-cross-account.test.ts `
  src/__tests__/rag-retrieval-v2.test.ts src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts src/__tests__/rag-safety-signals-4-7r3.test.ts
pnpm exec tsc --noEmit
```

The protected 68-file manifest covers the original 55 review/audit/dashboard files and all 13 E1 deliverables. Their bytes are retained; staging selected implementation files changes Git tracking, not those bytes. Existing scientific-review and owner-decision files are neither staged nor rewritten. New E3 import proposals are not owner decisions; the existing dashboard catalog/server/state remain unchanged.

Frozen pack SHA256: `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`. Frozen results SHA256: `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`. Evidence logs/manifest: ignored `artifacts/ai-coach-e3-preparation/2026-11-02-closeout/`.

No real Bedrock/Ollama/embedding/vector DB call; no production route/config, DB/index, merge or deployment. Public AWS documentation reads are not model invocation or account verification. Scientific improvement, support and personal applicability remain unmeasured/unknown.

See [E3 preparation](ai-coach-e3-preparation.md) for concrete remaining dependencies and the non-executable study proposal.
