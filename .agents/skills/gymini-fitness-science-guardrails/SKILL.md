---
name: gymini-fitness-science-guardrails
description: Body composition, body fat, FFMI, BMR, TDEE, calories, macros, weight forecasts, or nutrition-decision logic in Gymini. Load whenever a calculation or presentation of fitness/nutrition science is being added or changed.
---

# Gymini Fitness Science Guardrails

## Reuse the existing authoritative engines

Never create a second frontend (or second backend) TDEE/BMR/macro
engine. If a number is already computed by
`nutrition-decision.engine.ts`, `cycle-decision.engine.ts`,
`fitness-roadmap-forecast.engine.ts`, or the onboarding-bootstrap
calculation, call that — don't re-derive it with a slightly different
formula for a new surface. A silent second implementation is exactly
how two screens end up disagreeing about "your current calories."

## Distinguish these five categories explicitly, in copy and in code

- **MEASURED** — a real InBody entry.
- **USER-ENTERED** — self-reported (e.g. manual weight log).
- **ESTIMATED** — derived from a formula (Mifflin-St Jeor BMR when no
  measured BMR exists, body-fat from a photo/estimate method).
- **PROJECTED** — a forecast scenario, not a claim about the future.
- **PRESCRIBED** — the actual `NutritionGoal`/`WorkoutProgram` target.

Never present an ESTIMATED or PROJECTED number as if it were MEASURED or
PRESCRIBED.

## Language discipline

- Use phrasing equivalent to: "Khoảng dự báo tham khảo", "Chất lượng dữ
  liệu cho dự báo", "Dự kiến", "Ước tính", "Không phải cam kết kết quả."
- Do not present a heuristic forecast range as if it were a real
  statistical confidence interval.
- Do not expose an internal `confidenceScore`/`dataQualityScore` as a
  literal probability to the end user — it's an internal signal for
  gating/UX decisions (e.g. "not enough data yet"), not a number to show
  raw.
- Do not fabricate a body-fat percentage from a goal/reference image —
  if the estimation method is genuinely photo-based, be explicit that
  it's an estimate, and never silently treat it as MEASURED.
- Do not force a TEF (thermic effect of food) residual or any other
  fudge factor merely to make an energy-balance breakdown sum to a round
  number — an honest breakdown that doesn't perfectly sum is better than
  a fabricated correction term.

## NutritionGoal remains the actual prescription

Whatever this skill's calculations produce feeds INTO a decision
(`nutrition-decision.engine.ts`'s KEEP_PLAN/PROPOSE_ADJUSTMENT/etc.),
which then — only on accept — creates a new versioned `NutritionGoal`
row (see `gymini-domain-source-of-truth`). The calculation itself is
never the prescription; the accepted `NutritionGoal` version is.

## Definition of correct behavior

A user (or a PT reading `aiSummary`/`nutritionAiExplanation`) can always
tell, from the copy alone, whether a number is measured, estimated,
projected, or prescribed — never left to assume a forecast is a
guarantee, or an estimate is a measurement.

## Common failure modes

- A new UI card computing "estimated maintenance calories" itself
  instead of calling the existing decision engine's own output.
- Copy that says "Bạn cần X kcal" for a PROJECTED/ESTIMATED number
  without any qualifier, reading as a firm prescription.
- Summing macro grams to calories and forcing a match via an invented
  correction term instead of just showing the real numbers.
