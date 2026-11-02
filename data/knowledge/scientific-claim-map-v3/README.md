# Scientific Claim Map V3 — local inputs and release boundary

DEV/offline only. Owner approval, source identity and text matching do not establish independent scientific validation.

Private input-bundle/claim-map/source snapshots and review exports are intentionally not shipped in Git. No default personal path or embedded owner pin is used by the loader. Tests use the independent synthetic factory in src/__tests__/fixtures/scientific-claims.ts; it contains no real owner history or study evidence.

## Explicit external configuration

Provide a local, untracked JSON file with these fields:

```json
{
  "version": "claim-registry-local-config-v1",
  "inputBundleFile": "/absolute/private/input-bundle.json",
  "claimMapFile": "/absolute/private/claim-map.json",
  "currentOwnerDecisionsFile": "/absolute/private/current-owner-decisions.json",
  "trustedPins": {
    "inputBundleSha256": "<caller-trusted canonical bundle SHA256>",
    "ownerDecisionsSha256": "<caller-trusted current owner-file SHA256>"
  }
}
```

Use OS-appropriate absolute paths (including drive-qualified paths on Windows). The placeholders are deliberately invalid; fill them from the separately trusted owner handoff, not an untrusted packet. Missing files, wrong pins, changed current owner bytes, source-byte mismatches, invalid map content and draft releases fail closed. There is no automatic fallback to a test registry. Captured source bytes are validated as a frozen bundle; original source-machine paths are metadata, not a requirement on a new checkout and not proof of live service/corpus state.

From backend/services/ai-service:

```powershell
pnpm exec tsx src/knowledge/scientific-claim-map-v3/run.ts --validate --registry-config <absolute-local-config>
pnpm exec tsx src/evaluation/ai-coach-claim-dev/run.ts --mock --registry-config <absolute-local-config>
pnpm exec tsx --test src/__tests__/scientific-claim-map-v3.test.ts src/__tests__/ai-coach-claim-dev.test.ts src/__tests__/ai-coach-claim-correctness.test.ts
```

The E1 --build operation uses the same explicit config and refuses to overwrite the configured map file. Runtime validation rebuilds the expected map from hashed inputs; current owner bytes must match the externally supplied trusted pin. This config is not a signed scientific/data-release approval or LIVE authorization.

## Canonical wording, display and verification

approvedTextVi remains immutable. claimPresentation records the exact removed internal prefix and string offsets/hash; prefix + displayTextVi reconstructs canonical text. IDs belong in internal claimLinks metadata, not user-facing wording. Exact canonical/display identity is a strong bounded identity signal. Natural paraphrase, a missing final period or an introduction is not automatically contradicted; semantic entailment remains UNKNOWN unless separately verified.

Every claim text, conclusion, missing-information question and hypothesis follow-up is accounted for, including missing evidence links. unverifiedClaims and coverage distinguish reviewable text units, canonical identities and structured metric comparisons. Correct structured fields do not verify arbitrary observation prose. DEV_REVIEW_ONLY is an annotation/gate disposition, never an answer-safety or scientific correctness guarantee. Contract-valid unresolved text remains available for E3 usefulness/semantic review; legacy V3 hard failures and invalid references still block.

## Curated release artifact proposal

src/knowledge/scientific-claim-map-v3/release.ts defines a strict DRAFT_PENDING_OWNER_RELEASE_APPROVAL allowlist: claim IDs/version, exact canonical content, reversible display text, evidence references/hashes, population/applicability/limitations and prohibited inferences. It excludes decision history, owner records, AI drafts and provenance notes, uses repo-relative code references, and holds back rows containing an exact internal owner note in their scope fields. Draft content still needs manual owner release/privacy review; that limited check is not a DLP guarantee. The external registry loader rejects this draft as a runtime registry.

The actual draft instance is local/ignored and is not committed or published without explicit owner release approval. Existing private packet/source hashes and scientific decisions are not rewritten.

Current patch evidence and the non-independent 30-question benchmark: [E2 correctness closeout](../../../docs/research/ai-coach-e2-correctness-closeout.md). Earlier E1/E2/E3 handoff documents describe historical scopes and limitations.
