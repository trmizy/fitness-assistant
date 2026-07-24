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
  },
} as const;
