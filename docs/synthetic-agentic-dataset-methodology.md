# Synthetic Agentic Demo Dataset — Methodology

**Script**: `backend/services/user-service/src/scripts/seed-agentic-demo.ts` · **Run**: `ENABLE_AGENTIC_DEMO=true npm run dev:seed-agentic-demo` (from `backend/services/user-service`)

> **SYNTHETIC / DEMONSTRATION DATA — NOT REAL PT PERFORMANCE DATA, NOT EVIDENCE OF REAL-WORLD EFFECTIVENESS.** Every row is tagged `dataOrigin: "SYNTHETIC"` (`UserProfile`, `Contract`, `ClientJourney`) and is only ever returned to a caller that explicitly opts into demo mode (`AgentPreferences.demo: true`, gated by `ENABLE_AGENTIC_DEMO=true` outside non-production per `agentic-fitness.service.ts::originFor()`).

## Why this exists

The real platform has zero PT/journey data in any environment (feasibility audit §2.6). Without it, the historical-similarity engine (`journeySimilarity`/`summarizeJourneys`) and the PT-matching pipeline (`agenticFitnessService.candidates()`, `scorePT`) cannot be demonstrated or evaluated end-to-end. This dataset exists to exercise that pipeline realistically, not to claim anything about real coaching outcomes.

## Scale

60 PT profiles (within the 50–100 range requested), each with 1-2 `PTServicePackage` rows, `PTAvailability`, and (for non-cold-start archetypes) a cohort of synthetic clients/contracts/journeys/reviews. 331 `ClientJourney` rows, 331 `SessionReview` rows, in the run recorded 2026-09-14.

## Archetype distribution (deliberately not "60 amazing PTs")

| Archetype | Count | Design intent |
|---|---|---|
| `COLD_START` | 15 | No history at all — exercises the cold-start-fairness path in `scorePT` (evidence dimension absent, not zero) and the "Not enough historical evidence" cohort path |
| `ESTABLISHED_STRONG` | 15 | High adherence (0.8–1.0), meaningful body-composition improvement, 4–5★ reviews, 8–12 clients — reliably clears `minimumCohort` (5) |
| `ESTABLISHED_MIXED` | 12 | Adherence 0.4–0.9, mixed outcomes (some improve, some don't), 6–10 clients — sometimes clears the cohort threshold, sometimes doesn't |
| `ESTABLISHED_WEAK` | 8 | Low adherence (0.2–0.6), weak/negative outcomes, 2–5 clients — usually stays below `minimumCohort` |
| `NEW_STRONG_CREDENTIALS` | 5 | Low tenure (0-2 years) but verified certificates, strong early outcomes, wide availability — tests "new but credentialed" vs. "new and unproven" |
| `EXPERIENCED_AVERAGE_REVIEWS` | 5 | Experienced but unremarkable reviews/outcomes — tests that tenure alone doesn't guarantee a high score |

## Data source ranges (assumptions, not guarantees)

- Body-composition change ranges (e.g., `ESTABLISHED_STRONG`: −2 to −6 kg weight, −1.5 to −4 body-fat-% over 8–16 weeks) are **product-plausible magnitudes for a supervised training program**, not calibrated against any specific published trial — they exist to produce directionally sensible, non-dramatic synthetic outcomes, not to model a real population distribution. No claim of statistical realism is made.
- Session adherence ranges are set to be clearly differentiated across archetypes (0.2 floor for `WEAK`, 1.0 ceiling for `STRONG`) so the dataset is useful for testing ranking behavior, not fit to any real adherence-rate study.
- 10–20% of journeys per non-strong archetype intentionally have no `endingWeight`/`endingBodyFat` (a real, common data gap — `completesEndingInBody` per archetype), so `summarizeJourneys`'s `eligible` filter (which requires `endingWeight !== null`) is genuinely exercised, not trivially always-true.

## Experience-level concentration (a real fix made during evaluation)

An earlier version of this script assigned each synthetic client's `experienceLevel` uniformly at random across `BEGINNER`/`INTERMEDIATE`/`ADVANCED`. Because both the `candidates()` Prisma query (`experience: profile.experienceLevel`) and `journeySimilarity()` hard-require an **exact** experience match, this diluted every PT's same-experience cohort below `minimumCohort` even for `ESTABLISHED_STRONG` PTs with 8-10 clients — confirmed by a real failing integration test (`agentic-fitness-synthetic-cohort.test.ts`) before the fix. The fix: ~75% of each PT's clients share one deterministic "primary" experience level (a real product pattern — a beginner-focused coach mostly attracts beginners), with the remainder spread across the other two levels. Documented here rather than silently changed, since it's a real methodology decision, not a cosmetic tweak.

## Cold-start / availability realism

- `COLD_START` and `NEW_STRONG_CREDENTIALS` archetypes get wider availability (4-6 days/week) — a real product incentive: a new PT needs open slots to get booked at all.
- Established archetypes get narrower availability (2-4 days/week) — busier, realistic.
- `candidates()` hard-filters out any PT whose availability doesn't cover **every** day in the request — this is unchanged real product behavior, not relaxed for the synthetic data.

## What is deliberately NOT modeled

- `PTTrainingLocation` (province/ward) — skipped for this phase; `candidates()` only applies a location filter when the caller supplies `provinceCode`, so its absence doesn't block the core recommendation demo. A location-aware pass is a natural, easily-added follow-up if geo-filtered recommendation becomes a demo requirement.
- `nutritionAdherence` beyond a simple random float — no real nutrition-log-derived signal exists to model against.
- `strengthChangePercent` — left `null` throughout; no strength-test data source exists in this dataset (matches the real derivation service's own honesty about not fabricating this field).
- Medical/rehabilitation specialties or credentials — not assigned to any synthetic PT, since the real qualification model doesn't support them (per this task's own explicit instruction not to invent regulated medical claims).

## Reproducibility

Deterministic via `GYMINI_AGENTIC_SEED` (default `"gymini-agentic-demo-v1"`) driving both a seeded PRNG (mulberry32) and every row's id (`sha256(seed:parts...)`, the same construction already used by `agentic-fitness.service.ts::createDraft`). Re-running the script with the same seed **upserts** the same rows — verified live: a second run after the first produced identical row counts (60 PTs / 331 journeys / 331 reviews / 331 synthetic clients), confirmed by a direct DB count query, not just the script's own self-reported totals.

## Non-production guard

The script throws immediately if `NODE_ENV === "production"` or if `ENABLE_AGENTIC_DEMO !== "true"` — both checked before any DB write, not just documented.
