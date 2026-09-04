/**
 * All numeric thresholds for training-cycle rolling alerts and end-of-cycle
 * pre-classification live here — never hard-code a threshold inline in the
 * service logic. Every value is env-overridable so a coach/admin can tune
 * behavior without a code change; defaults match the spec's threshold table.
 */
function num(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const cycleThresholds = {
  // Early-warning alert rules (evaluated on new InBody entry / end of week)
  alerts: {
    bulkWeightLossConsecutiveEntries: num("CYCLE_ALERT_BULK_WEIGHT_LOSS_STREAK", 2),
    cutStalledWeeks: num("CYCLE_ALERT_CUT_STALLED_WEEKS", 3),
    fatigueRpeIncreaseWeeks: num("CYCLE_ALERT_FATIGUE_RPE_WEEKS", 3),
    lowAdherencePctAtWeek2: num("CYCLE_ALERT_LOW_ADHERENCE_PCT", 60),
  },

  // End-of-cycle deterministic pre-classification (progressSignals)
  classification: {
    // Delta skeletal muscle mass (kg) over the cycle — goal MUSCLE_GAIN
    smmProgressingMinKg: num("CYCLE_SMM_PROGRESSING_MIN_KG", 0.3),
    smmDecliningMaxKg: num("CYCLE_SMM_DECLINING_MAX_KG", -0.2),

    // Delta body fat % over the cycle — goal WEIGHT_LOSS
    pbfProgressingMaxPct: num("CYCLE_PBF_PROGRESSING_MAX_PCT", -0.8),
    pbfDecliningMinPct: num("CYCLE_PBF_DECLINING_MIN_PCT", 0.3),

    // When bulking, what fraction of weight gained is allowed to be fat
    // before it's flagged as excessive (vs lean mass gain)
    bulkFatGainWarnFraction: num("CYCLE_BULK_FAT_GAIN_WARN_FRACTION", 0.6),
    bulkFatGainOkFraction: num("CYCLE_BULK_FAT_GAIN_OK_FRACTION", 0.4),

    // Training volume change: last week vs first week of the cycle
    volumeProgressingMinPct: num("CYCLE_VOLUME_PROGRESSING_MIN_PCT", 5),
    volumeDecliningMaxPct: num("CYCLE_VOLUME_DECLINING_MAX_PCT", -5),

    // Adherence (completed sessions / planned sessions)
    adherenceProgressingMinPct: num("CYCLE_ADHERENCE_PROGRESSING_MIN_PCT", 80),
    adherenceDecliningMaxPct: num("CYCLE_ADHERENCE_DECLINING_MAX_PCT", 60),

    // How many of a muscle group's weekly-volume data points must be below
    // the cycle median to call it "lagging"
    laggingMuscleGroupCount: num("CYCLE_LAGGING_MUSCLE_GROUP_COUNT", 2),
  },

  // InBodyDataQualityEvaluator — outlier/interval detection. Product
  // defaults reflecting plausible short-term physiological change, not a
  // medical standard.
  inbodyQuality: {
    // A day-over-day weight change rate beyond this (kg/day, averaged over
    // the gap between two entries) is flagged as an outlier rather than
    // trusted as real fat/muscle change (most such swings are water/food/
    // hydration, not tissue change).
    maxPlausibleWeightChangeKgPerDay: num("CYCLE_INBODY_MAX_WEIGHT_KG_PER_DAY", 0.35),
    // Body-fat % change beyond this between two consecutive entries is
    // flagged as an outlier (device noise or non-fasted/inconsistent
    // measurement conditions are far more likely than real fat-mass change
    // at this speed).
    maxPlausibleBodyFatPctChange: num("CYCLE_INBODY_MAX_BODYFAT_PCT_CHANGE", 3),
    // Two entries closer together than this are too close to treat as an
    // independent trend data point (not an outlier, just low trend value).
    minMeaningfulIntervalDays: num("CYCLE_INBODY_MIN_INTERVAL_DAYS", 3),
  },

  // Adaptive Training Cycle Evaluation — CycleDecisionEngine (6-state) gate
  // thresholds. These are product defaults, not medical/scientific
  // constants — tune via env per coaching philosophy.
  assessment: {
    minimumCycleDays: num("CYCLE_ASSESSMENT_MIN_CYCLE_DAYS", 28),
    minimumCompletedSessions: num("CYCLE_ASSESSMENT_MIN_COMPLETED_SESSIONS", 8),
    minimumAdherenceRate: num("CYCLE_ASSESSMENT_MIN_ADHERENCE_RATE", 0.7),
    minimumComparableInBodyRecords: num("CYCLE_ASSESSMENT_MIN_COMPARABLE_INBODY", 2),
    plateauWindowWeeks: num("CYCLE_ASSESSMENT_PLATEAU_WINDOW_WEEKS", 3),
    highPainScore: num("CYCLE_ASSESSMENT_HIGH_PAIN_SCORE", 7),
    lowConfidenceThreshold: num("CYCLE_ASSESSMENT_LOW_CONFIDENCE_THRESHOLD", 0.6),

    // Level-aware Decision Engine tuning (docs/USER_LEVEL_PERSONALIZATION_PLAN.md).
    // Beginners rarely accumulate enough real training fatigue to need a
    // deload in a first block — require a higher fatigue/lower recovery
    // reading before DELOAD fires for them. Advanced/professional lifters
    // train closer to their real capacity, so the same engine should react
    // to fatigue/poor recovery earlier for this group (§C, §D).
    highFatigueScoreDefault: num("CYCLE_ASSESSMENT_HIGH_FATIGUE_DEFAULT", 0.7),
    highFatigueScoreBeginner: num("CYCLE_ASSESSMENT_HIGH_FATIGUE_BEGINNER", 0.85),
    highFatigueScoreAdvanced: num("CYCLE_ASSESSMENT_HIGH_FATIGUE_ADVANCED", 0.6),
    lowRecoveryScoreDefault: num("CYCLE_ASSESSMENT_LOW_RECOVERY_DEFAULT", 0.35),
    lowRecoveryScoreBeginner: num("CYCLE_ASSESSMENT_LOW_RECOVERY_BEGINNER", 0.25),
    lowRecoveryScoreAdvanced: num("CYCLE_ASSESSMENT_LOW_RECOVERY_ADVANCED", 0.45),
    // PROGRESS bar: a competing/professional athlete (ADVANCED + competesInSport)
    // pays a higher real-world cost for a wrong "you're ready to push more"
    // call (competition prep), so require a stronger composite score before
    // recommending progression than for a recreational lifter (§D).
    progressScoreThresholdDefault: num("CYCLE_ASSESSMENT_PROGRESS_SCORE_DEFAULT", 0.35),
    progressScoreThresholdProfessional: num("CYCLE_ASSESSMENT_PROGRESS_SCORE_PROFESSIONAL", 0.5),
    // Professional athletes (ADVANCED + competesInSport) get an extra,
    // stricter INSUFFICIENT_DATA gate on top of the shared gates — per the
    // design doc, an under-confident quantitative call costs more for this
    // group (affects competition prep), so a mediocre data-quality score
    // that would still be enough for a recreational ADVANCED lifter should
    // not be enough here.
    professionalMinimumDataQualityScore: num("CYCLE_ASSESSMENT_PROFESSIONAL_MIN_DATA_QUALITY", 0.65),
  },

  // Phase 5 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — how session
  // feedback (CycleFeedbackSummary + AI interpretation) is allowed to
  // influence the Decision Engine's output. Feedback is a SIGNAL, never a
  // standalone decision — see cycle-decision.engine.ts's applyFeedbackInfluence.
  feedback: {
    // Below this feedback dataQualityScore (cycle-feedback-aggregator.ts),
    // feedback is not trusted enough to move the decision at all — mirrors
    // "missing feedback => no strong change" from the spec.
    minimumDataQualityScore: num("CYCLE_FEEDBACK_MIN_DATA_QUALITY", 0.34),
    // Professional/competing athletes require a stronger feedback data bar
    // before it's allowed to influence anything, same rationale as the
    // metrics-side professionalMinimumDataQualityScore above.
    professionalMinimumDataQualityScore: num("CYCLE_FEEDBACK_PROFESSIONAL_MIN_DATA_QUALITY", 0.6),
    // Fraction of feedback-submitted sessions marked too_hard/too_easy
    // required before that complaint is treated as a real pattern rather
    // than one outlier session.
    tooHardMajorityFraction: num("CYCLE_FEEDBACK_TOO_HARD_MAJORITY_FRACTION", 0.4),
    tooEasyMajorityFraction: num("CYCLE_FEEDBACK_TOO_EASY_MAJORITY_FRACTION", 0.4),
    // Beginners get an extra adherence margin on top of the base
    // minimumAdherenceRate before a "too easy" feedback pattern is allowed
    // to push the decision up to PROGRESS — mirrors the engine's existing
    // beginner-conservative philosophy for the metrics-only PROGRESS rule.
    beginnerProgressExtraAdherence: num("CYCLE_FEEDBACK_BEGINNER_PROGRESS_EXTRA_ADHERENCE", 0.1),
  },

  // Real-time body profile / evidence-based adaptive nutrition refactor,
  // spec §8/§26 — rolling weight trend used for adaptive reasoning instead
  // of reacting to any single day's weight. These are an engineering
  // heuristic (a smoothing window), not a scientific constant — see
  // ENERGY-001 in docs/research/fitness-nutrition-evidence.md: weight
  // response to intake changes is not perfectly linear day-to-day, so a
  // single noisy reading must never drive a plan change on its own.
  weightTrend: {
    // Fewer readings than this in the window => trend confidence is LOW,
    // regardless of how the numbers look — not enough data to smooth over
    // day-to-day noise (water weight, meal timing, measurement conditions).
    minWeightSamples: num("WEIGHT_TREND_MIN_SAMPLES", 4),
    // Only readings within this many days of "now" are considered part of
    // the current trend window.
    trendWindowDays: num("WEIGHT_TREND_WINDOW_DAYS", 14),
    // At or above this many samples (still within the window), confidence
    // is HIGH rather than MEDIUM.
    highConfidenceSamples: num("WEIGHT_TREND_HIGH_CONFIDENCE_SAMPLES", 7),
  },

  // Phase 2 — Adaptive Nutrition Decision Engine (nutrition-decision.engine.ts).
  // Every numeric value here is a PRODUCT_HEURISTIC (an engineering/product
  // default), not a value handed down by a specific paper — see
  // docs/research/fitness-nutrition-evidence.md's "Product heuristics"
  // section. Papers inform the DIRECTION of a rule (e.g. "don't act on one
  // reading", "gradual loss can preserve lean mass"); they do not specify
  // "cut exactly 150 kcal", so that number lives here, tunable via env, and
  // must never be described to a user as a scientific figure.
  nutritionAdaptive: {
    // A calorie-adjustment proposal changes the active prescription by this
    // many kcal/day per step — deliberately modest so a single adjustment
    // is never a shock; larger sustained gaps get caught by re-evaluation
    // at the next window rather than one big jump.
    calorieAdjustmentStepKcal: num("NUTRITION_ADAPTIVE_CALORIE_STEP_KCAL", 150),
    minCalorieAdjustmentKcal: num("NUTRITION_ADAPTIVE_MIN_CALORIE_ADJUSTMENT_KCAL", 100),
    maxCalorieAdjustmentKcal: num("NUTRITION_ADAPTIVE_MAX_CALORIE_ADJUSTMENT_KCAL", 300),
    // Never propose a prescription below this floor regardless of goal/trend
    // — a basic safety rail, not a clinical minimum.
    minPrescriptionCalories: num("NUTRITION_ADAPTIVE_MIN_PRESCRIPTION_KCAL", 1200),

    // Weeks of an off-target (plateaued or wrong-direction) trend required
    // before PROPOSE_ADJUSTMENT can fire — reuses the same "how long is a
    // plateau" window already established for the training decision engine
    // (cycleThresholds.assessment.plateauWindowWeeks) rather than a second,
    // possibly-inconsistent number.
    minAdherenceForAdjustment: num("NUTRITION_ADAPTIVE_MIN_ADHERENCE_FOR_ADJUSTMENT", 0.7),

    // Weight-loss pace band, expressed as % of body weight per week —
    // informed by Garthe et al. 2011 (FATLOSS-001: ~0.7%/week vs ~1.4%/week
    // in elite athletes; slower group did better) but generalized as a
    // PRODUCT default reference band for this app's broader (non-elite-
    // athlete) user base, not a copy of that study's exact figures.
    weightLossPaceSlowPctPerWeek: num("NUTRITION_ADAPTIVE_WEIGHT_LOSS_PACE_SLOW_PCT", 0.3),
    weightLossPaceFastPctPerWeek: num("NUTRITION_ADAPTIVE_WEIGHT_LOSS_PACE_FAST_PCT", 1.0),

    // Maintenance/recomposition "stable enough" tolerance band, kg/week.
    maintenanceToleranceKgPerWeek: num("NUTRITION_ADAPTIVE_MAINTENANCE_TOLERANCE_KG", 0.25),

    // Protein floor/ceiling, g/kg body weight/day — NUTRITION-001 (Jäger et
    // al. 2017 ISSN position stand): 1.4-2.0 g/kg/day is the evidence-
    // supported general range for healthy exercising adults. A proposed
    // calorie change must never silently drag protein below this floor.
    proteinFloorGPerKg: num("NUTRITION_ADAPTIVE_PROTEIN_FLOOR_G_PER_KG", 1.4),
    proteinCeilingGPerKg: num("NUTRITION_ADAPTIVE_PROTEIN_CEILING_G_PER_KG", 2.0),
  },
} as const;
