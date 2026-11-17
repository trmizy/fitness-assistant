# Fitness & Nutrition Evidence Registry

Source-of-truth summary for the evidence backing the AI's body-data/adaptive-reasoning rules
(`prompt_builder.ts`'s "BODY DATA & ADAPTIVE REASONING RULES" block). Each entry is:
citation → finding summary → applicability → limitations → product implication → AI rule.
No paper's full text is reproduced — only paraphrased findings and real, verified PMIDs/DOIs.

**Status**: `data/processed/evidence/_index.json` holds 31 entries total, **all live in the RAG
pipeline** — embedded (local Ollama `nomic-embed-text`) and indexed in the `fitness_evidence`
Qdrant collection, retrievable by `retriever.retrieveEvidence()`. The 14 entries below
(NUTRITION-002 through SAFETY-001), added in the AI-nutrition-overhaul pass to cover the spec's
full 15-source list (1, ISSN protein, already existed), were ingested via
`npm run knowledge:pipeline` (`ai-service`) on 2026-08-18: 28 chunks processed, **25 newly
embedded and upserted**, 3 automatically rejected as semantic duplicates of already-embedded
content (creatine, Morton protein meta-analysis, and Slater surplus chunks scored >0.95 cosine
similarity against existing points — correctly skipped by the pipeline's own duplicate detector
rather than double-embedding near-identical content). Qdrant's `fitness_evidence` collection
point count went from 127 to 152. Verified directly against the running collection, not just
inferred from script exit code.

Classification key, per spec §59 — every claim below is one of:
- **SCIENTIFIC_EVIDENCE** — a specific finding from a cited paper.
- **PRODUCT_HEURISTIC** — an engineering convention (e.g. a smoothing window) *informed* by
  evidence but not itself a scientific claim.
- Neither is a substitute for **USER_PREFERENCE** or **CLINICAL_REVIEW_REQUIRED**, which the AI
  must reach for separately when applicable (see prompt_builder.ts rules).

---

## ENERGY-001 — Dynamic Energy Balance

**Citation**: Hall KD et al. "Quantification of the effect of energy imbalance on
bodyweight." *Lancet*, 2011. PMID [21872751](https://pubmed.ncbi.nlm.nih.gov/21872751/), DOI
[10.1016/S0140-6736(11)60812-X](https://doi.org/10.1016/S0140-6736(11)60812-X)

**Finding**: Body-weight change in response to an energy-intake change is dynamic — energy
expenditure adapts as weight/composition change, so a fixed deficit does not produce a fixed
linear rate of loss indefinitely. The "3500 kcal = 1 lb" rule of thumb does not hold over
realistic timeframes.

**Applicability**: General adult weight management.

**Limitations**: A population-level quantitative model, not a per-individual prediction —
individual variation exists.

**Product implication**: Never treat a calorie target as producing a fixed weekly weight
change forever. Re-evaluate prescriptions against observed trend data periodically.

**AI rule**: Do not treat weight change as a static linear calorie equation. *(SCIENTIFIC_EVIDENCE)*

---

## BODYCOMP-001 — InBody 770 Validation

**Citation**: Brewer GJ et al. "Validation of InBody 770 bioelectrical impedance analysis
compared to a four-compartment model criterion in young adults." 2021. PMID
[33752260](https://pubmed.ncbi.nlm.nih.gov/33752260/), DOI
[10.1111/cpf.12700](https://doi.org/10.1111/cpf.12700)

**Finding**: Against a 4-compartment-model criterion, InBody 770 carried a total error of
~4.2 percentage points for body-fat%, and ~2.4 kg for fat mass and fat-free mass each.

**Applicability**: Young adults; BIA devices generally (InBody specifically validated).

**Limitations**: Error margins may differ by population (age, hydration status, disease state)
not covered in this specific validation.

**Product implication**: A body-fat% change of, say, 24.0% → 25.0% between two scans is well
within this device's known error band — do not present it as a confirmed 1-point change.

**AI rule**: Treat BIA body composition as an estimate. Do not overinterpret small week-to-week
changes. *(SCIENTIFIC_EVIDENCE)*

---

## BODYCOMP-002 — Measurement Standardization

**Citation**: Tinsley GM et al. "Tracking changes in body composition: comparison of methods
and influence of pre-assessment standardisation." 2022. PMID
[34325758](https://pubmed.ncbi.nlm.nih.gov/34325758/), DOI
[10.1017/S0007114521002579](https://doi.org/10.1017/S0007114521002579)

**Finding**: Non-standardized pre-assessment conditions (time of day, fasted/fed, hydration,
recent exercise) can distort the apparent body-composition change between two readings,
independent of any real tissue change.

**Applicability**: Any longitudinal body-composition tracking, BIA or otherwise.

**Limitations**: Degree of distortion depends on which conditions varied and by how much — not
a single universal correction factor.

**Product implication**: Confidence in a longitudinal trend should account for how
standardized the measurement conditions were. This repo's `InBodyEntry` doesn't currently
capture measurement-condition metadata (fasted/rested/time-of-day) — a real gap noted for
future work, not fabricated here.

**AI rule**: Confidence in longitudinal body-composition changes should account for measurement
conditions. *(SCIENTIFIC_EVIDENCE)*

---

## WEARABLE-001 — Energy Expenditure Error

**Citation**: Shcherbina A et al. "Accuracy in Wrist-Worn, Sensor-Based Measurements of Heart
Rate and Energy Expenditure in a Diverse Cohort." 2017. PMID
[28538708](https://pubmed.ncbi.nlm.nih.gov/28538708/)

**Finding**: Wrist-worn devices measured heart rate reasonably well but energy-expenditure
(calorie burn) estimates carried substantially larger errors across devices and activities.

**Applicability**: Consumer wrist-worn wearables generally.

**Limitations**: Tested a specific set of devices/activities as of 2017; newer devices/
algorithms may have since improved (this repo has no wearable integration to test against
either way — see below).

**Product implication**: N/A currently — confirmed via full-repo audit that this codebase has
**zero existing wearable/steps/calorie-burn integration** (frontend or backend). This entry is
forward-looking, for if/when that feature is ever built.

**AI rule**: Wearable calorie expenditure is an estimate, not ground truth. *(SCIENTIFIC_EVIDENCE)*

---

## NUTRITION-001 — Protein

**Citation**: Jäger R et al. "International Society of Sports Nutrition Position Stand:
protein and exercise." 2017. PMID [28642676](https://pubmed.ncbi.nlm.nih.gov/28642676/), DOI
[10.1186/s12970-017-0177-8](https://doi.org/10.1186/s12970-017-0177-8)

*(Already present in this repo's evidence set as `issn-protein-2017.jsonl` prior to this pass
— not re-added, just documented here for completeness of the pack the spec requested.)*

**Finding**: For most physically active healthy adults, 1.4–2.0 g/kg body weight/day protein
is sufficient to build/maintain muscle; higher intakes (2.3–3.1 g/kg fat-free mass) may be
warranted during energy restriction.

**Applicability**: Healthy, physically active adults.

**Limitations**: Not validated for kidney disease, other medical contraindications, or unknown
medical conditions — those require professional review, not a blanket high-protein rule.

**Product implication**: Use as a general reference range, not a blind prescription — escalate
to a healthcare professional for flagged medical conditions.

**AI rule**: For most healthy exercising adults, 1.4–2.0 g/kg/day is an evidence-supported
general range; individual context still matters. *(SCIENTIFIC_EVIDENCE)*

---

## FATLOSS-001 — Rate of Weight Loss in Athletes

**Citation**: Garthe I et al. "Effect of two different weight-loss rates on body composition
and strength and power-related performance in elite athletes." 2011. PMID
[21558571](https://pubmed.ncbi.nlm.nih.gov/21558571/)

**Finding**: Compared ~0.7%/week vs ~1.4%/week body-weight loss in elite athletes; the slower
group showed more favorable body-composition/strength outcomes in this study's context.

**Applicability**: Elite/trained athletes in the studied (competition-prep-like) context.

**Limitations**: Small, athlete-specific sample — must not be generalized as a universal rule
for every user regardless of training status or goal.

**Product implication**: Can inform a gradual, lean-mass-preserving reference pace as a
**PRODUCT_HEURISTIC**, personalized per user — never a hard universal rule.

**AI rule**: Gradual weight loss can be preferable when preservation of lean mass/performance
is important; do not generalize athlete-specific findings to every user. *(SCIENTIFIC_EVIDENCE
for the athlete population; anything broader is PRODUCT_HEURISTIC)*

---

## ENERGY-002 — Adaptive Thermogenesis

**Citation**: Nunes CL et al. "Does adaptive thermogenesis occur after weight loss in adults?
A systematic review." PMID [33762040](https://pubmed.ncbi.nlm.nih.gov/33762040/)

**Finding**: Adaptive thermogenesis (an expenditure drop beyond what reduced mass alone
explains) can occur after weight loss, but its magnitude varies considerably across
individuals and studies.

**Applicability**: General adult weight-loss population (systematic review, multiple studies).

**Limitations**: Magnitude is not a fixed, universally quantifiable number — this review
explicitly does not provide one to apply per-individual.

**Product implication**: Can be cited as context/explanation for a plateau; must never be
converted into an invented, precise per-user correction number.

**AI rule**: Adaptive thermogenesis can occur but varies across individuals — never invent an
exact adaptation number without measurement/model support. *(SCIENTIFIC_EVIDENCE for the
existence/variability claim; any specific number for a specific user is unsupported)*

---

## NUTRITION-002 — Protein Supplementation Meta-Analysis

**Citation**: Morton RW et al. "A systematic review, meta-analysis and meta-regression of the
effect of protein supplementation on resistance training-induced gains in muscle mass and
strength in healthy adults." *British Journal of Sports Medicine*, 2018. PMID
[28698222](https://pubmed.ncbi.nlm.nih.gov/28698222/)

**Finding**: Meta-regression of 49 studies (1863 participants) found the added benefit of
protein intake for resistance-training-induced fat-free mass gain plateaus around ~1.6 g/kg/day
total daily intake, with no further average benefit for muscle mass from higher pooled intakes.

**Applicability**: Healthy adults doing resistance training.

**Limitations**: A pooled/average plateau point — individual response varies, and this does not
establish an upper safety limit, only a diminishing-returns point for hypertrophy specifically.

**Product implication**: 1.6 g/kg/day is a defensible practical protein starting point inside
the ISSN 1.4-2.0 g/kg/day range (`PROTEIN_PRACTICAL_STARTING_POINT_G_PER_KG` in
`nutrition_engine.ts`) — not a hard ceiling.

**AI rule**: Do not automatically recommend increasing protein above ~1.6-2.0 g/kg/day for
hypertrophy; higher intake is not established to add further muscle-gain benefit on average.
*(SCIENTIFIC_EVIDENCE)*

---

## NUTRITION-003 — Nutrition and Athletic Performance Joint Position Statement

**Citation**: Thomas DT, Erdman KA, Burke LM. "Nutrition and Athletic Performance." Joint
Position Statement, Academy of Nutrition and Dietetics / Dietitians of Canada / ACSM.
*Medicine & Science in Sports & Exercise*, 2016. PMID
[26891166](https://pubmed.ncbi.nlm.nih.gov/26891166/)

**Finding**: Protein needs for athletes span ~1.2-2.0 g/kg/day depending on sport/phase;
carbohydrate needs scale with training volume/intensity from ~3-5 g/kg/day (light training) up
to ~8-12 g/kg/day (very high-volume endurance) — a recreational gym-goer typically needs far
less carbohydrate than an endurance athlete.

**Applicability**: Athletes across a range of sports and training loads.

**Limitations**: A position statement synthesizing broad literature, not a single controlled
trial; ranges are wide and must be individualized.

**Product implication**: Never apply an endurance-athlete carbohydrate g/kg figure to a
recreational gym trainee by default; individualize by actual training volume/type.

**AI rule**: Carbohydrate needs must scale with real training volume/intensity, not a flat
number; fat must never be restricted below the range needed for essential fatty acids and
hormone production. *(SCIENTIFIC_EVIDENCE)*

---

## NUTRITION-004 — ISSN Nutrient Timing

**Citation**: Kerksick CM et al. "International society of sports nutrition position stand:
nutrient timing." *Journal of the International Society of Sports Nutrition*, 2017. PMID
[28919842](https://pubmed.ncbi.nlm.nih.gov/28919842/)

**Finding**: Total daily energy/macronutrient intake is the primary driver of body-composition
and performance outcomes; nutrient timing (meal distribution, peri-workout intake) provides a
secondary, generally smaller effect. Distributing protein across 3-6 meals/day (~0.25-0.4 g/kg,
commonly ~20-40g per meal) can help maximize muscle protein synthesis across the day.

**Applicability**: General resistance-trained population.

**Limitations**: A position stand, not a single trial; the "anabolic window" concept it
addresses is now considered overstated for most training contexts, not zero-effect.

**Product implication**: Present per-meal protein distribution as a practical strategy to aid
compliance, never as a strict requirement — total daily protein and adherence matter more than
exact per-meal timing.

**AI rule**: Never imply a narrow post-workout "anabolic window" must be hit within minutes;
total daily intake is the primary lever. *(SCIENTIFIC_EVIDENCE)*

---

## SURPLUS-001 — Is an Energy Surplus Required for Hypertrophy?

**Citation**: Slater GJ et al. "Is an Energy Surplus Required to Maximize Skeletal Muscle
Hypertrophy Associated With Resistance Training?" *Frontiers in Nutrition*, 2019.
[PMC6710320](https://pmc.ncbi.nlm.nih.gov/articles/PMC6710320/)

**Finding**: Meaningful hypertrophy can occur without a caloric surplus, and even during an
energy deficit, particularly for novice trainees, individuals with higher starting body-fat, or
those returning to training after a layoff.

**Applicability**: Especially relevant to "body recomposition" candidates (novices, detrained,
higher body-fat).

**Limitations**: A narrative review synthesizing mixed-quality evidence; does not establish a
single universal recomposition protocol.

**Product implication**: A muscle-gain goal must not default to "always prescribe a surplus" —
for eligible profiles, maintenance or a modest deficit can be presented as a valid path.

**AI rule**: Do not force every muscle-gain request into a bulk; recognize when body
recomposition is a reasonable alternative. *(SCIENTIFIC_EVIDENCE for the possibility;
PRODUCT_HEURISTIC for which specific users qualify)*

---

## SURPLUS-002 — Small vs. Large Energy Surplus

**Citation**: Helms ER et al. — comparison of smaller vs. larger energy surplus for hypertrophy
and body composition during structured resistance training.
[PMC10620361](https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/)

**Finding**: A smaller, more conservative surplus tends to produce a more favorable lean-mass-
to-fat-mass gain ratio than a large surplus, which mainly accelerates fat gain once
training-driven hypertrophy capacity is roughly being met.

**Applicability**: Resistance-trained individuals in a structured muscle-gain phase.

**Limitations**: "Small" vs "large" are relative categories across studies, not one exact
universally-optimal percentage.

**Product implication**: Backs this codebase's `CONSERVATIVE_SURPLUS_PCT`/
`LARGE_SURPLUS_WARNING_PCT` config (`nutrition_engine.ts`) as a defensible default, explicitly
labeled PRODUCT_HEURISTIC for the exact percentages, SCIENTIFIC_EVIDENCE for the directional
claim.

**AI rule**: Flag a large calorie surplus as likely to increase fat gain without a matched
increase in muscle-gain benefit. *(SCIENTIFIC_EVIDENCE for direction; PRODUCT_HEURISTIC for the
exact % bounds)*

---

## ENERGY-003 — Mifflin-St Jeor Original Equation

**Citation**: Mifflin MD, St Jeor ST, et al. "A new predictive equation for resting energy
expenditure in healthy individuals." *American Journal of Clinical Nutrition*, 1990. PMID
[2305711](https://pubmed.ncbi.nlm.nih.gov/2305711/)

**Finding**: Derived RMR = 10×weight(kg) + 6.25×height(cm) − 5×age(y) + 5 (men) or −161
(women), shown more accurate on average than the older Harris-Benedict equation for the
contemporary healthy adult population studied.

**Applicability**: Healthy, non-pregnant, non-elite-athlete adults — the population this
codebase's `nutrition_calculator.ts` targets.

**Limitations**: Not validated for children, pregnancy/lactation, or atypical body composition
(very high muscle mass, clinical conditions affecting metabolism).

**Product implication**: This is the formula already implemented as the baseline BMR estimate;
its scope limits must be respected — not blindly applied outside the validated population.

**AI rule**: Never apply Mifflin-St Jeor to children, pregnancy, or athletes with highly atypical
body composition without flagging it as an out-of-validated-scope estimate.
*(SCIENTIFIC_EVIDENCE)*

---

## ENERGY-004 — RMR Predictive Equation Accuracy

**Citation**: Systematic review of predictive resting-metabolic-rate equations against measured
(indirect calorimetry) RMR. [PMC7299486](https://pmc.ncbi.nlm.nih.gov/articles/PMC7299486/)

**Finding**: Mifflin-St Jeor is consistently among the more accurate widely-used equations on
average, but individual-level prediction error commonly runs ±10-15% (sometimes more) for any
single person.

**Applicability**: General adult population RMR estimation.

**Limitations**: Population-average accuracy does not guarantee individual accuracy.

**Product implication**: Any calorie estimate must be presented as a range/estimate with
explicit uncertainty, refined against the individual's own observed weight-trend/intake data
over 2-4 weeks — never as a single precise number trusted on day one.

**AI rule**: Always present calorie estimates with an uncertainty range and explicit "estimate,
not exact" framing; prioritize observed trend data over the formula once available.
*(SCIENTIFIC_EVIDENCE)*

---

## NUTRITION-005 — Acceptable Macronutrient Distribution Ranges (AMDR)

**Citation**: National Academies of Sciences (Institute of Medicine), Dietary Reference Intakes
for Macronutrients. [NBK610333](https://www.ncbi.nlm.nih.gov/books/NBK610333/)

**Finding**: AMDR for adults: carbohydrate 45-65% of energy, protein 10-35% of energy, fat
20-35% of energy — ranges associated with reduced chronic-disease risk while providing adequate
essential-nutrient intake.

**Applicability**: General adult population sanity range.

**Limitations**: Not sport-specific; an athlete's macro split may reasonably sit at the edge of
or slightly outside these bounds without being unsafe.

**Product implication**: A proposed macro split far outside AMDR (e.g. near-zero carb or fat)
should be flagged as an outlier requiring explicit justification, not silently accepted.

**AI rule**: Use AMDR as a general-population sanity check, not an athlete-specific optimum —
flag extreme deviations rather than block on them outright. *(SCIENTIFIC_EVIDENCE)*

---

## NUTRITION-006 — Dietary Guidelines for Americans 2020-2025

**Citation**: U.S. Departments of Health & Human Services and Agriculture, *Dietary Guidelines
for Americans, 2020-2025*.
[Full PDF](https://www.dietaryguidelines.gov/sites/default/files/2021-03/Dietary_Guidelines_for_Americans-2020-2025.pdf)

**Finding**: Recommends added sugars < 10% of daily calories, saturated fat < 10% of daily
calories, sodium < 2,300 mg/day for adults, and a diet built around vegetables, fruits, whole
grains, lean protein, and dairy/fortified alternatives.

**Applicability**: General U.S. adult population; used here as a general food-quality reference,
not athlete-specific.

**Limitations**: Population guidance, not a personalized prescription; some active individuals
may reasonably exceed sodium guidance due to higher sweat losses.

**Product implication**: A generated meal plan should default toward whole, minimally-processed
foods with controlled added sugar/saturated fat/sodium — not just hit a calorie/macro number
(directly informs Part 6's food-diversity/serving-realism rules).

**AI rule**: Meal suggestions should favor whole foods and respect general sodium/added-sugar/
saturated-fat guidance alongside macro targets. *(SCIENTIFIC_EVIDENCE for the guideline values;
PRODUCT_HEURISTIC for how the meal-generator weighs them against macro-fit)*

---

## SUPPLEMENT-001 — Creatine Safety and Efficacy

**Citation**: Kreider RB et al. "ISSN position stand: safety and efficacy of creatine
supplementation in exercise, sport, and medicine." *Journal of the International Society of
Sports Nutrition*, 2017. PMID [28615996](https://pubmed.ncbi.nlm.nih.gov/28615996/)

**Finding**: Creatine monohydrate is one of the most extensively researched, effective, and safe
ergogenic supplements for healthy individuals at recommended doses (~3-5 g/day maintenance;
loading is optional, only speeds up saturation).

**Applicability**: Healthy adults doing resistance/high-intensity training.

**Limitations**: Safety data is strongest for healthy adults; not a substitute for medical
clearance in people with relevant kidney/liver conditions.

**Product implication**: Creatine can be presented as an evidence-supported OPTIONAL addition
for eligible healthy adults — never auto-added to a meal/supplement plan.

**AI rule**: Present creatine as optional, evidence-backed, at standard doses only; never
auto-add it. *(SCIENTIFIC_EVIDENCE)*

---

## SUPPLEMENT-002 — Caffeine and Exercise Performance

**Citation**: Guest NS et al. "International society of sports nutrition position stand:
caffeine and exercise performance." *Journal of the International Society of Sports Nutrition*,
2021. PMID [33388079](https://pubmed.ncbi.nlm.nih.gov/33388079/)

**Finding**: Caffeine (~3-6 mg/kg, ~60 min pre-exercise) can improve endurance and, more
variably, strength/power performance; individual response varies substantially by genetics
(e.g. CYP1A2) and habitual intake.

**Applicability**: General trained population, individual response varies widely.

**Limitations**: Can impair sleep, raise heart rate/anxiety in sensitive individuals; interacts
with some medications and cardiovascular conditions.

**Product implication**: Caffeine guidance must ask about sensitivity, sleep habits, anxiety,
cardiovascular history, and medications before suggesting a dose, and must never suggest a high
dose.

**AI rule**: Never suggest caffeine dosing without checking sensitivity/sleep/cardiovascular/
medication factors first, and never recommend a high dose. *(SCIENTIFIC_EVIDENCE)*

---

## SUPPLEMENT-003 — IOC Dietary Supplements Consensus

**Citation**: IOC consensus statement: dietary supplements and the high-performance athlete.
*British Journal of Sports Medicine*, 2018. PMID
[29540367](https://pubmed.ncbi.nlm.nih.gov/29540367/)

**Finding**: Recommends "food first" — supplements only once diet/training/lifestyle are
optimized and only for an identified need; highlights real contamination risk (undeclared
banned substances) in the supplement industry, recommends third-party-tested products where
athletes are subject to anti-doping testing.

**Applicability**: General athlete/active population.

**Limitations**: A consensus/position statement, not a single trial.

**Product implication**: Any supplement suggestion defaults to "food first," is never
auto-added, and includes a product-quality/testing-risk note, not just an efficacy claim.

**AI rule**: Food first; supplements only for an identified need; always mention product-quality/
third-party-testing considerations. *(SCIENTIFIC_EVIDENCE for the consensus recommendations)*

---

## HYDRATION-001 — Fluid Replacement for the Physically Active

**Citation**: National Athletic Trainers' Association (NATA) Position Statement: Fluid
Replacement for the Physically Active, 2017 update. PMID
[28985128](https://pubmed.ncbi.nlm.nih.gov/28985128/)

**Finding**: Fluid needs are individual, driven by sweat rate (body size, intensity, heat,
humidity) rather than one fixed daily volume for everyone; body-weight change before/after
exercise is a practical individualized proxy (~1kg lost ≈ ~1L fluid to replace). Both
dehydration and over-hydration (exercise-associated hyponatremia) are real risks.

**Applicability**: General physically active population.

**Limitations**: A position statement synthesizing broad evidence, not a single-number formula.

**Product implication**: Never state a single fixed water-volume figure derived from bodyweight
alone; use duration/intensity/climate as rough signals and point toward body-weight-change
tracking for precision, while warning against both under- and over-drinking.

**AI rule**: Never recommend "drink as much as possible"; hydration guidance must warn about
both dehydration and overhydration/hyponatremia. *(SCIENTIFIC_EVIDENCE)*

---

## SAFETY-001 — Relative Energy Deficiency in Sport (REDs)

**Citation**: IOC consensus statement on Relative Energy Deficiency in Sport (REDs), 2023
update. *British Journal of Sports Medicine*.
[bjsm.bmj.com/content/57/17/1073](https://bjsm.bmj.com/content/57/17/1073)

**Finding**: Prolonged low energy availability can impair bone, hormonal, immune,
cardiovascular, and psychological health, and affects both men and women (broader than the
earlier "Female Athlete Triad" framing). Warning signs include unexplained performance decline,
menstrual disruption, frequent illness/injury, and persistently very-low reported intake
relative to training load.

**Applicability**: Anyone combining sustained low energy intake with meaningful training
volume, not only elite/female athletes.

**Limitations**: A consensus statement identifying risk factors/screening signals, not a
diagnostic tool this app can apply clinically.

**Product implication**: A sustained very-low-calorie target combined with high training volume
must be treated as a REDs-risk signal routed to safety escalation (EARLY_REVIEW-equivalent) —
never used as a reason to push a more aggressive deficit or higher training volume.

**AI rule**: Under a REDs-risk signal (very low calories + high training load, or the warning
signs above), never continue toward a more aggressive deficit or added volume — route to a
support-and-refer response instead. *(SCIENTIFIC_EVIDENCE)*

---

## Product heuristics (not scientific claims — labeled as such deliberately)

- **7-14 day rolling weight-trend window, confidence LOW/MEDIUM/HIGH by sample count**
  (`weight-trend.util.ts`, `cycleThresholds.weightTrend`) — an engineering smoothing
  convention informed by ENERGY-001/BODYCOMP-002's "don't over-read single readings" findings,
  but the specific window/thresholds are product defaults, not derived from a specific paper.
  *(PRODUCT_HEURISTIC)*
- **"User's stated target weight of 72kg"** — always USER_PREFERENCE, never re-classified as
  scientific evidence or overridden without the user's explicit confirmation.
