# 09 — Health, Safety & Constraint Audit

## 1. What exists today — all deterministic, no ML in production

Every safety mechanism currently load-bearing in ai-service is regex/rule-based. No ML classifier is currently deployed (see §3).

| Layer | File | Behavior |
|---|---|---|
| Main safety gate | `src/llm/safety_guard.ts` (652 lines) | Runs **first** in the orchestrator, before any profile/RAG/LLM call. Regex-detects 12 categories: unsafe rapid/extreme weight loss, medical-emergency symptoms, PED/steroid dosing, extreme/very-low-calorie (<800 kcal) and "severe energy restriction" (800-1199 kcal, cites IOC RED-S/ACSM/Helms literature), prompt-injection, medical-nutrition-condition, minor-age-nutrition, pregnancy/breastfeeding-nutrition, eating-disorder-disclosure, severe-allergy-disclosure, prolonged-extreme-calorie-disclosure. Each returns a canned bilingual message and **short-circuits the entire pipeline**. |
| Fine-grained symptom classifier | `src/llm/safety-signals.ts` (152 lines, "pure, no LLM, no I/O") | Classifies free text into signal classes (RADIATING_PAIN, NEUROLOGICAL_SYMPTOM, SUDDEN_POP_OR_SNAP, ACUTE_TRAUMA_EVENT, CHEST_OR_CARDIO_RED_FLAG, POST_SURGICAL/POSTPARTUM/PREGNANCY_STATE) → `SafetyLevel` (NONE/CAUTION/HIGH_RISK). Fails closed on RAG: HIGH_RISK forces abstention or curated-evidence-only answers. |
| Narrative composition | `safety-envelope.ts` / `safety-narrative.ts` | Turns the signal classification into a structured trace, never raw text, consumed for the final safety action. |
| Point-fix | `src/agent-workflow/target-weight-safety.ts` | BMI-aware (WHO BMI<18.5 "underweight") rejection of an unsafe target weight during goal-update slot collection. **Explicitly documented as the only height-aware safety check anywhere in the codebase** — not a general pattern. |
| Narration-only rule | `src/llm/body_composition_rules.ts` | BMI-threshold rules that qualify body-composition narration (e.g. overweight BMI≥25) — not a hard gate, just phrasing guidance. |

## 2. What these mechanisms do NOT do — the critical distinction this audit must state plainly

**Every one of the above affects only the current turn.** None of them write a persistent constraint that survives into subsequent plan-generation calls. This is confirmed by direct code trace (§07 Case C): `safety-signals.ts`'s own documentation says it only gates the current turn's RAG; there is no chat-writable field anywhere in ai-service for a disclosed injury/limitation (`agentUpdatableProfileFieldsSchema` is a strict whitelist that excludes it); and even a pre-existing known injury in the profile produces only a warning **string** on a workout preview, never an automatic exercise exclusion — the responsible function's own comment admits this outright.

**This is the single most important health/safety finding in the audit**: the system correctly detects and reacts to a safety signal in the moment (abstains, warns, routes to curated evidence), but has no mechanism to durably remember "this user has a leg injury, never propose leg exercises again" across turns or across a workflow correction. See gap `BDG-16` (CONFIRMED_LIVE_DEFECT, P1) and `BDG-17` (the same root cause in the slot-filling workflow specifically) in `10-business-gap-register.md`.

A 4th compounding factor confirmed by the same investigation: the one exclusion mechanism that *does* exist (explicit named-exercise exclusion during an active draft revision) only whole-token-matches **English catalog exercise names** — a Vietnamese injury phrase like "tránh bài chân" could never match tokens like "Leg Press"/"Squat" even if a user tried to invoke it directly. Given this product's primary user base communicates in Vietnamese (confirmed throughout this audit — nearly all UI strings, notification templates, and doc commentary are Vietnamese), this is a real, user-facing-language-specific gap, not a hypothetical edge case.

## 3. The ML safety classifier that exists but isn't deployed

`src/llm/query-classifiers/` contains a genuinely trained (offline, via `src/scripts/trainQueryClassifiers.ts`) lightweight classifier (TF-IDF/embedding features, Platt calibration, pure TypeScript inference — no sklearn/pickle/GPU dependency) for routing tasks **including "personal-safety."** Its `artifacts/` directory — where it would load model weights from — **is empty in this checkout**. The module's own code states that any load/inference failure yields `null`, and callers fall back to the deterministic regex path. **This is a real, built capability that is not currently load-bearing** — worth flagging for the roadmap (it's closer to production than building from scratch) but should not be described as "AI-powered safety routing is live" without that caveat.

## 4. Cross-reference to the independent production-readiness audit

`docs/production-readiness/07-ai-llm-safety.md` and `00-executive-summary.md` independently rate AI safety as **CONDITIONAL**: "No LLM DB writes, atomic confirmation, tools off by default" (positive) vs. "LLM use outside the flag, 170-second turns" (G-17/G-18, negative) — consistent with this audit's own findings about flags not fully gating LLM use. That audit did not investigate the specific constraint-persistence question this audit's Case C/D investigation answers — the two audits are complementary, not overlapping, on this topic.

## 5. Distinguishing a health statement from a permanent diagnosis

Per task §15's explicit concern ("do not automatically convert a health statement into a permanent diagnosis"): this is currently a non-issue only because the opposite failure mode dominates — nothing persists at all, so there's no risk of over-persisting a transient statement as permanent. Once `BDG-16`/`BDG-17` are fixed (adding real persistence for disclosed limitations), the fix must be designed with an explicit user-confirmed, user-editable constraint (not a silent permanent flag) to avoid trading one failure mode for the opposite one — this is a design constraint for whoever implements the fix, not a currently-observed defect.

## 6. Summary verdict

| Question | Answer |
|---|---|
| Does Gymini detect health/safety-relevant disclosures? | Yes — robustly, deterministically, in the current turn. |
| Does it correctly abstain/escalate on high-risk signals? | Yes — `safety-signals.ts` fails closed on RAG for HIGH_RISK. |
| Does a disclosed limitation durably constrain subsequent AI-generated plans? | **No — confirmed live defect (BDG-16, BDG-17).** |
| Is there an ML-based safety layer live in production? | No — built, trained, but not deployed (empty model-artifacts directory). |
| Can a later plan-generation request silently override an earlier safety-relevant disclosure? | Not applicable in the sense the task worried about (nothing is silently overridden because nothing is persisted to begin with) — but this means the disclosure provides **zero protection** on the very next plan-generation turn, which is arguably worse. |
