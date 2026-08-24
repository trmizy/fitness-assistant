# Nutrition product and evidence review

Research date: 2026-08-18

Scope: redesign the Fitness Assistant nutrition experience so beginners can start without knowing calories/macros, while experienced lifters and athletes can still use advanced targets.

## Product research

| Source | Evidence type | Conclusion | Product impact |
|---|---|---|---|
| MacroFactor help: nutrition logging frequency and expenditure algorithm | Official product documentation | Coaching updates depend on weight trend plus sufficiently consistent nutrition logs. MacroFactor says at least 4 logged days per 7-day period are needed for continuous updates, ideally daily. | Weekly review must check data quality before changing targets. If logs are sparse, hold targets and explain why. |
| MacroFactor help: check-ins and coaching modules | Official product documentation | Weekly check-ins can recommend calorie/macro changes; users can decline a check-in. Modules ask clarifying questions only when useful. | Fitness Assistant target changes should be proposals, not silent overwrites. Add accept/reject/tune workflow. |
| MyFitnessPal Meal Planner | Official product documentation | Meal planning is customized around goals, budget, lifestyle, preferences and allergies; users can swap recipes and log meals to diary. It has minimum calorie guardrails. | Beginner plan creation should collect ordinary inputs, respect allergies/preferences, support swaps, and save planned meals into the diary. |
| MyFitnessPal goal customization | Official product documentation | Users can use recommended calories or turn them off for custom goals. Macro targets can be customized; MFP warns against very low calories. | Guided mode should default to "AI calculates"; collaborative mode can accept custom calories/macros with validation. |
| Cronometer Daily Report | Official product documentation | The daily report separates consumed calories, expenditure, target/balance, macro targets and micronutrient summaries. | UI must separate target, plan, actual intake and remaining budget instead of mixing them into one number. |
| Cronometer Nutrient Targets | Official product documentation | Nutrient targets can be automatic or custom; micronutrients may have min/max targets and some nutrients lack reliable universal targets. | Micronutrients should be progressive disclosure and labelled as targets/thresholds, not absolute medical rules. |
| RP Diet Coach app comparison | Official product documentation | RP is a coaching app, not only a tracker; it builds plans from schedule, lifestyle, goals, progress and compliance. | Performance mode should model session schedule and meal timing instead of one static daily target. |
| RP Diet Coach safety | Official product documentation | RP anchors adjustments around TDEE, weekly progress and daily schedule; it limits diet length, weekly weight-loss rate, BMI floor, and minimum fat/carbs. | Add deterministic safety guardrails for extreme calories, rapid weight change, minimum fat/carbs and red-flag escalation. |

## Sports nutrition evidence

| Source | Evidence type | Conclusion | Calculation or guardrail impact |
|---|---|---|---|
| ISSN position stand: protein and exercise | Position stand/review | For most healthy exercising adults, 1.4-2.0 g/kg/day protein is sufficient for muscle gain or maintenance; 20-40 g per serving is a common practical range. | Use 1.6 g/kg as a practical start, raise within range by goal/context, and do not apply high protein automatically to kidney disease or other medical contexts. |
| Morton et al. 2018 protein meta-analysis | Systematic review/meta-analysis | Resistance training gains are supported by higher protein intake, with diminishing returns near common evidence-based ranges. | Avoid pushing protein ever higher once the target is already reasonable. |
| ACSM/AND/DC Nutrition and Athletic Performance | Consensus position statement | Energy, carbohydrate, protein, fat, fluids and timing need to match training load, body composition goal and athlete context. | Training/rest-day targets and athlete fueling require deterministic context, not one generic daily meal plan. |
| ISSN nutrient timing position stand | Position stand/review | Total daily intake matters most; timing is more useful around training demands and high-volume athletes. | Beginner mode should not overemphasize timing; performance mode can expose pre/intra/post-workout fueling. |
| Burke et al. carbohydrate for training and competition | Review/consensus | Carbohydrate intake should vary by training load and competition demands. | Endurance/performance mode needs carbohydrate periodization by session, not only daily calories. |
| Mifflin-St Jeor equation | Original validation study | Predictive equations estimate resting energy needs but have error; they are starting points, not truth. | Calculator returns a range and assumptions; it should adapt only after enough weight/intake data. |
| IOC RED-S consensus | Consensus statement | Low energy availability can impair health and performance; risk screening is important, especially for athletes. | Add RED-S red flags and escalate instead of optimizing aggressive plans. |
| NATA fluid replacement position statement | Position statement | Hydration advice should account for sweat loss, environment and exercise duration; overhydration is also a risk. | Hydration answers should ask for sweat-rate data or explain how to measure it. |
| ISSN creatine and caffeine position stands | Position stands | Creatine and caffeine can be useful in specific contexts but require dosage, tolerance and contraindication handling. | Supplement QA belongs in general nutrition QA with safety flags, not meal-plan lookup. |

## Product decisions for this repository

1. Nutrition chat lookup is not the same as nutrition QA. Saved meal lookup should run only when the user explicitly asks to view stored meals/logs/plans. Calories, macro, supplement, hydration, safety and analysis questions must continue to the LLM/RAG/deterministic calculator path.
2. New users should see Guided mode by default. Calories are optional; if absent, the system calculates an evidence-informed range from ordinary profile inputs.
3. Collaborative mode can accept custom calories/macros, but the app must validate Atwater calories (`protein*4 + carbs*4 + fat*9`) and warn before saving contradictory targets.
4. Athlete/performance mode requires training/rest-day targets, session timing, hydration by sweat rate and RED-S screening.
5. The source of truth must distinguish personal target, active plan and actual intake. Only one effective target should apply per day.
6. Weekly check-in should hold changes when nutrition logging is insufficient and should require user confirmation before applying a new target version.
7. Food generation should prefer normal foods available to the user, not supplement powders as default protein anchors. Supplements remain optional substitutions.
8. Safety and medical contexts must fail closed: under-18, pregnancy, kidney/liver/cardiovascular disease, diabetes, eating-disorder language, rapid weight change, very low calories, RED-S signs and acute symptoms need triage or expert referral.

## Root-cause notes from code audit

| Issue | File/function | Finding | Change made in this pass |
|---|---|---|---|
| General nutrition QA returned only "no meal today" | `backend/services/ai-service/src/llm/nutrition_context.ts` / `detectNutritionLookupIntent` | The previous condition enabled nutrition lookup for any nutrition keyword, including calories, macro, protein and general diet questions. The orchestrator then early-returned before RAG/LLM. | Lookup now requires an explicit saved-data action such as show/view/saved/diary/log, while calorie estimation and macro analysis continue through the normal AI path. |
| `bodyFatPct` string validation error | `backend/services/ai-service/src/schemas/nutrition-plan.schemas.ts` and `frontend/web/src/app/pages/client/CurrentNutritionProgram.tsx` | HTML number inputs can produce strings; backend schema previously required real numbers. | Request schema now coerces form numbers and treats empty optional fields as omitted; frontend submit sanitizes optional numeric fields. |
| Beginners forced to know calories | `frontend/web/src/app/pages/client/CurrentNutritionProgram.tsx` | Nutrition generation modal defaulted calories to `2000`. | Calories field now starts empty and payload omits it so backend/AI can calculate. |
| UI error/backend success mismatch risk | `CurrentNutritionProgram.tsx` | Submit cleaned only selected numeric fields and omitted `bodyFatPct`; duplicate jobs could be submitted while a nutrition job was processing. | Submit now uses one sanitizer, blocks when a nutrition job is already processing, and modal resets after close/success. |

## Limits

This pass did not finish the full Nutrition v2 product. Remaining work: full three-mode UI, target-version conflict picker, weekly check-in screen, richer deterministic calculation service, food optimizer scoring by normal Vietnamese food patterns, and real browser E2E with the three personas.

## Sources

- MacroFactor logging and expenditure: https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition-for-the-expenditure-algorithm-and-weekly-coaching-updates
- MacroFactor check-ins: https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules
- MyFitnessPal Meal Planner: https://support.myfitnesspal.com/hc/en-us/articles/34347103172877-Meal-Planner
- MyFitnessPal goal customization: https://support.myfitnesspal.com/hc/en-us/articles/360032274432-Customize-your-nutritional-goals
- Cronometer Daily Report: https://support.cronometer.com/hc/en-us/articles/32689033683220-Mobile-Daily-Report
- Cronometer Nutrient Targets: https://support.cronometer.com/hc/en-us/articles/360060170532-Nutrient-Targets
- RP Diet Coach app comparison: https://help.rpstrength.com/hc/en-us/articles/33256541236119-How-is-the-RP-Diet-Coach-App-different-from-other-apps
- RP Diet Coach safety: https://help.rpstrength.com/hc/en-us/articles/33327568055447-How-does-the-app-keep-me-safe-while-dieting
- ISSN protein position stand: https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0177-8
- Protein meta-analysis: https://pubmed.ncbi.nlm.nih.gov/28698222/
- Nutrition and Athletic Performance: https://pubmed.ncbi.nlm.nih.gov/26891166/
- ISSN nutrient timing: https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0189-4
- Carbohydrate for training and competition: https://pubmed.ncbi.nlm.nih.gov/21660838/
- Mifflin-St Jeor equation: https://pubmed.ncbi.nlm.nih.gov/2305711/
- IOC RED-S: https://bjsm.bmj.com/content/57/17/1073
- NATA fluid replacement: https://pubmed.ncbi.nlm.nih.gov/28985128/
- ISSN caffeine: https://pubmed.ncbi.nlm.nih.gov/33388079/
