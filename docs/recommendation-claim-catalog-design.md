# Structured Claim Grounding — Recommendation Narrator Design

**Date**: 2026-09-14 · Written in response to `docs/codex-ai-agent-regression-3-report.md` (NO-GO, ADV-001 HIGH: 48/50 fourth-generation narrator attacks accepted). Companion: `docs/ai-agent-hardening-fix-report.md`'s "PHASE 4 ADDENDUM".

## Why regex validation could not be fixed by adding more regex

Three regression passes traced the same failure shape:

| Pass | Approach | Result |
|---|---|---|
| Regression #1 | Flat blacklist of known bad strings | Closed 50/50 known cases |
| Regression #2 | Wider semantic-category regex + negation awareness | Closed 30/30 known + 8/8 controls; **24/30 NEW paraphrases bypassed** |
| Phase 3 | Structured-claim-category regex (bigger vocabulary, root-caused a diacritic bug) | Closed 255/255 known cases across R1+R2; **48/50 NEW (4th-gen) paraphrases bypassed** |

Codex's own Regression #3 assessment named the actual defect: *"the architecture is still a regex category recognizer... it does not actually parse or ground the claim category; it matches a finite vocabulary."* No vocabulary — however wide, however many synonym families — can enumerate every future paraphrase of "assert a fact this call has no data for." That is a trust-boundary error, not a coverage gap. Patching the 48 new strings would only produce a Regression #4 with a 49th.

## The fix: move the trust boundary

Old (unsafe) design:

```
Enterprise facts -> LLM writes prose -> regex validator guesses if it's true -> user
```

New design:

```
Enterprise facts -> deterministic Claim Catalog -> LLM selects claim IDs only
  -> candidate-scoped ID validation -> deterministic renderer -> user
```

**Invariant**: no LLM-generated factual sentence is ever shown directly as an authoritative recommendation explanation. The LLM may select and order already-grounded claims; the server owns every word of the final text.

## Claim catalog (`recommendation_claims.ts`)

`ClaimType` is a closed union of 10 types. Each is backed by a real field already available on `NarrationInputCandidate` (`PTCandidate` + `CompatibilityScore` + `HistoricalSummary`) or the real supplied `AgentEvidence[]` — nothing is inferred or guessed:

| Type | Grounded from | Built only when |
|---|---|---|
| `COMPATIBILITY` | `compatibility.total` | always |
| `GOAL_MATCH` | `compatibility.components.goal` | `>= 1` |
| `SCHEDULE_MATCH` | `compatibility.components.schedule` | `> 0` |
| `BUDGET_MATCH` | `compatibility.components.budget` | `>= 1` |
| `REPUTATION` | `candidate.averageRating`/`.reviewCount` | `reviewCount>=5 && averageRating!==null` (same threshold `scorePT` itself uses) |
| `HISTORICAL_EVIDENCE` | `history.count/dataOrigin/medianTrainingAdherence/completionRate` | `history.count > 0` |
| `INSUFFICIENT_HISTORY` | (disclosure only) | `history.count === 0` — mutually exclusive with the above |
| `SCIENTIFIC_EVIDENCE` | real `AgentEvidence` item | one per real supplied evidence item |
| `EXPERIENCE` | `candidate.yearsExperience` | non-empty |
| `CERTIFICATION` | `candidate.certificates[i]` | only `verificationStatus === "VERIFIED"` |

**Deliberately absent** (no type exists for any of these — Regression #3's entire accepted-attack list): price, specific package/session count, weekday availability, location/proximity, schedule-fit *guarantee*, comparative budget ranking, medical/PED/hormonal claims, unauthorized action-completion language, comparative superiority, score-contradiction, implied/unverified credentials. None of these has a real per-call grounding field in `NarrationInputCandidate`. **This is the actual mechanism that makes new paraphrase attacks irrelevant**: a paraphrase can only select among IDs that already exist in the catalog; there is no field anywhere to put an invented fact into, regardless of how it's worded.

Claim ids are candidate-scoped by construction: `${candidateId}::${suffix}` (e.g. `pt-42::REPUTATION`). A selection naming an id from a different candidate's catalog is filtered out before rendering — proven by `recommendation_narrator_claims.test.ts`'s cross-candidate-attack test.

## LLM contract (`ClaimSelectionSchema`, `.strict()`)

```ts
{
  candidateId: string;
  selectedClaimIds: string[];
  ordering?: string[];
  emphasis?: "BALANCED" | "GOAL_FIT" | "SCHEDULE" | "EVIDENCE";
  tone?: "CONCISE" | "SUPPORTIVE";
}
```

`.strict()` on both the item and batch schema means an extra field (e.g. an injected `"summary"` string) fails the WHOLE batch's Zod parse — proven live in `recommendation_narrator_claims.test.ts` via the real Zod `unrecognized_keys` error, not simulated. `callLlmJson` catches the parse failure and the affected candidate(s) fall back to the deterministic default selection; the injected text never reaches the renderer.

## Deterministic renderer (`renderClaim`, `renderNarrationFromClaims`)

`renderClaim(claim)` is the **only** function in the codebase that produces user-facing narration text — a fixed Vietnamese template per `ClaimType`, an exhaustive TypeScript `switch` with a `never`-checked default. Two disclosures are **mandatory**, not LLM-selectable:

- `INSUFFICIENT_HISTORY` always renders into `uncertainty` whenever present in the catalog, regardless of `selectedClaimIds`.
- The synthetic-origin sentence ("dữ liệu demo tổng hợp... không phải bằng chứng về hiệu quả huấn luyện thực tế") is baked into `HISTORICAL_EVIDENCE`'s own render branch when `origin === "SYNTHETIC"` — there is no code path that can render that claim type without it.

This is why **ADV-005 (false-positive rejection of safe disclaimers) disappears structurally**: Regression #3's two false positives ("No result can be guaranteed", the synthetic-demo disclaimer) were both cases of a regex misjudging free LLM prose. There is no free LLM prose left for a regex to misjudge — the disclaimer text is a fixed server template that is never run through any classifier at all.

## Failure/timeout behavior

`buildDefaultSelection(catalog)` picks a small, fixed, sensible set of claims (compatibility, goal/schedule/budget match, reputation, historical evidence or insufficient-history, experience, certification, one scientific-evidence claim) with zero LLM dependency. `narrateRecommendations()` uses it whenever the LLM call fails, times out, returns no selection for a candidate, or every selected id for that candidate was invalid. Every candidate always receives a full, claim-grounded narration — this is strictly better than the old behavior of silently dropping that candidate's narration entirely.

## Why `validateNarration()` was NOT wired into the new pipeline

This was tried during this pass and reverted. `renderClaim`'s `CERTIFICATION` sentence ("...có chứng chỉ đã xác minh: {name} ({issuer})...") is real, server-owned, fully-grounded text — but `validateNarration`'s `CERTIFICATION_CATEGORY` pattern bans the word "chứng chỉ" **unconditionally**, regardless of origin (a deliberate Phase-3 design choice, correct for LLM-authored text, since a regex cannot verify an arbitrary invented proper noun matches a real one). Wiring the old validator into the new pipeline would have silently rejected a legitimate, newly-added, fully-safe feature — for a threat model (LLM-invented certificate names) that no longer exists once the renderer is the only thing that ever prints a certificate name.

`validateNarration()` itself is kept **fully unchanged and exported** — Codex's evaluator calls it directly with hand-built free-form strings, and per this task's own instruction ("preserve backward compatibility OR clearly prove why its tested path is no longer reachable"), it still behaves byte-for-byte as it did after Phase 3 (255/298 identical). Its Regression #3 48+2 fails are **expected and disclosed**: they test a free-form-prose path production no longer routes any real narration through. See `recommendation_narrator.ts`'s own doc comment (search "PHASE 4 STATUS") for the full reasoning in code.

## Test coverage

- `recommendation_claims.test.ts` (19 tests) — pure-function catalog/renderer tests: per-type grounding conditions, candidate-scoped id prefixes, "no forbidden claim type exists" assertion, synthetic-disclosure always-present, unknown-type safety (`renderClaim` never throws).
- `recommendation_narrator_claims.test.ts` (6 tests) — `narrateRecommendations()` end-to-end with a stubbed LLM: failure-fallback, valid live selection, cross-candidate attack, strict-schema injection, unknown claim type, disabled-flag contract.
- `recommendation_narrator.test.ts` (41 tests, unchanged) — direct `validateNarration()` regression coverage, preserved for Codex's backward-compatible direct-call tests.
