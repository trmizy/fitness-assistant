/**
 * Gate 7 — human review workflow for the exercise duplicate/variant
 * candidates Gate 5/6's automatic importers deliberately never act on
 * (exerciseLocalizationImporter only auto-links EXACT_SAME_SOURCE/
 * EXACT_CROSS_SOURCE; newExerciseImporter only auto-imports DISTINCT/
 * POSSIBLE_VARIANT — LIKELY_DUPLICATE and MANUAL_REVIEW are NEVER acted
 * on automatically, per the task's explicit rule).
 *
 * "Pending" is computed FRESH every call — never a static list — by
 * re-running the same Gate 3 detector (exercise-duplicate-detector.ts)
 * against the CURRENT live catalog, then excluding any catalog row that
 * already has a real ExerciseSource link (sourceName=SOURCE). This is the
 * single source of truth for "is this candidate already resolved" — the
 * exact same check newExerciseImporter.ts's own idempotency already
 * relies on — so the review queue can never drift from what's actually in
 * the database.
 *
 * This service NEVER deletes, overwrites, or auto-merges anything. Every
 * mutating action it can take (create a new STAGING exercise, link an
 * alias onto an EXISTING exercise) is the exact same, already-tested
 * write path Gate 5/6's own importers use — this only adds WHO decided
 * and WHY, recorded durably in ExerciseReviewDecision.
 */
import { prisma } from "../repositories/prisma";
import {
  detectDuplicate,
  type ExerciseMatchCandidate,
  type DuplicateMatchResult,
  type DuplicateDecision,
} from "./exercise-duplicate-detector";
import {
  loadCatalog,
  loadLiveExercises,
  createStagingExerciseFromCatalogRow,
  SOURCE,
  type CatalogRow,
} from "../importers/newExerciseImporter";
import { normalizeVietnamese } from "../utils/normalizeVietnamese";
import * as crypto from "crypto";

export type ReviewDecisionKind =
  | "APPROVE_AS_NEW_STAGING"
  | "LINK_AS_ALIAS_OF_EXISTING"
  | "MARK_AS_DUPLICATE_SKIP"
  | "NEEDS_MORE_INFO"
  | "REJECT_RECORD";

// Decisions that create/modify real Exercise/Alias/Source data — used for
// the "can this be silently resubmitted with a DIFFERENT decision"
// idempotency guard below (changing your mind is only unsafe once real
// data was actually created/linked).
const DATA_MUTATING_DECISIONS = new Set<ReviewDecisionKind>(["APPROVE_AS_NEW_STAGING", "LINK_AS_ALIAS_OF_EXISTING"]);
// Decisions risky/consequential enough to require a human's stated
// reasoning, even when (like REJECT_RECORD) they don't touch Exercise
// data — a rejection permanently steers this catalog row away from ever
// being imported, so it deserves the same "why" as an approval does.
const NOTE_REQUIRED_DECISIONS = new Set<ReviewDecisionKind>(["APPROVE_AS_NEW_STAGING", "LINK_AS_ALIAS_OF_EXISTING", "REJECT_RECORD"]);
const VALID_DECISIONS = new Set<ReviewDecisionKind>([
  "APPROVE_AS_NEW_STAGING",
  "LINK_AS_ALIAS_OF_EXISTING",
  "MARK_AS_DUPLICATE_SKIP",
  "NEEDS_MORE_INFO",
  "REJECT_RECORD",
]);

function rawNameJaccard(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const setA = tok(a);
  const setB = tok(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function toCandidate(row: CatalogRow): ExerciseMatchCandidate {
  return {
    id: row.externalId,
    name: row.nameEn,
    source: "curated_vi_catalog",
    externalId: row.externalId,
    equipment: row.equipment,
    primaryMuscles: row.primaryMuscles,
    movementPattern: row.movementPattern,
    mechanics: row.isCompound ? "compound" : "isolation",
  };
}

interface BestMatch {
  candidate: ExerciseMatchCandidate;
  result: DuplicateMatchResult;
}

function findBestMatch(row: CatalogRow, live: ExerciseMatchCandidate[]): BestMatch | null {
  const candidate = toCandidate(row);
  let best: (BestMatch & { tiebreak: number }) | null = null;
  for (const liveCandidate of live) {
    const result = detectDuplicate(candidate, liveCandidate);
    if (result.decision === "DISTINCT") continue;
    const tiebreak = rawNameJaccard(row.nameEn, liveCandidate.name);
    if (!best || result.confidence > best.result.confidence || (result.confidence === best.result.confidence && tiebreak > best.tiebreak)) {
      best = { candidate: liveCandidate, result, tiebreak };
    }
  }
  return best;
}

async function loadResolvedExternalRefs(): Promise<Set<string>> {
  const rows = await prisma.exerciseSource.findMany({
    where: { sourceName: SOURCE, externalId: { not: null } },
    select: { externalId: true },
  });
  return new Set(rows.map((r) => r.externalId as string));
}

export interface ReviewCandidateSummary {
  externalRef: string;
  nameEn: string;
  nameVi: string;
  movementPattern: string;
  equipment: string[];
  primaryMuscles: string[];
  duplicateDecision: DuplicateDecision;
  confidence: number;
  matchedFields: string[];
  conflictingFields: string[];
  proposedAction: string;
  bestMatchExercise: { id: string; name: string; referenceCount: number } | null;
  reviewStatus: ReviewDecisionKind | "PENDING";
  reviewedAt: string | null;
  reviewNote: string | null;
}

async function referenceCountByExerciseId(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const [workoutRefs, programRefs] = await Promise.all([
    prisma.workoutExercise.groupBy({ by: ["exerciseId"], where: { exerciseId: { in: ids } }, _count: { _all: true } }),
    prisma.workoutProgramExercise.groupBy({ by: ["exerciseId"], where: { exerciseId: { in: ids } }, _count: { _all: true } }),
  ]);
  const map = new Map<string, number>();
  for (const r of workoutRefs) map.set(r.exerciseId, (map.get(r.exerciseId) ?? 0) + r._count._all);
  for (const r of programRefs) map.set(r.exerciseId, (map.get(r.exerciseId) ?? 0) + r._count._all);
  return map;
}

/** Every catalog row not yet resolved (no ExerciseSource link), with its
 * FRESHLY recomputed duplicate decision and any human review already on
 * record. This is the Gate 7 queue's actual data source — never a cached
 * or historical snapshot. */
/** The append-only table can hold multiple rows per externalRef (a
 * reviewer's decision evolving over time) — "the current decision" is
 * always the NEWEST row. Fetches everything once and reduces client-side
 * rather than N+1 queries per candidate. */
async function loadLatestDecisions(): Promise<Map<string, { decision: string; note: string | null; updatedAt: Date; createdExerciseId: string | null; targetExerciseId: string | null }>> {
  const rows = await prisma.exerciseReviewDecision.findMany({
    where: { source: SOURCE },
    orderBy: { createdAt: "asc" },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(row.externalRef, row); // later rows overwrite earlier ones — asc order means the last write wins
  return latest;
}

export async function listReviewCandidates(filters: {
  status?: "PENDING" | "REVIEWED" | "ALL";
  decisionTier?: DuplicateDecision;
  search?: string;
}): Promise<{ candidates: ReviewCandidateSummary[]; summary: Record<string, number> }> {
  const { rows: catalog } = loadCatalog();
  const live = await loadLiveExercises();
  const resolved = await loadResolvedExternalRefs();
  const decisionByRef = await loadLatestDecisions();

  const unresolvedRows = catalog.filter((row) => !resolved.has(row.externalId));
  const bestMatches = new Map(unresolvedRows.map((row) => [row.externalId, findBestMatch(row, live)]));
  const matchedExerciseIds = [...bestMatches.values()].filter((m): m is BestMatch => !!m).map((m) => m.candidate.id);
  const refCounts = await referenceCountByExerciseId([...new Set(matchedExerciseIds)]);

  let candidates: ReviewCandidateSummary[] = unresolvedRows.map((row) => {
    const best = bestMatches.get(row.externalId) ?? null;
    const reviewDecision = decisionByRef.get(row.externalId);
    return {
      externalRef: row.externalId,
      nameEn: row.nameEn,
      nameVi: row.nameVi,
      movementPattern: row.movementPattern,
      equipment: row.equipment,
      primaryMuscles: row.primaryMuscles,
      duplicateDecision: best?.result.decision ?? "DISTINCT",
      confidence: best?.result.confidence ?? 0,
      matchedFields: best?.result.matchedFields ?? [],
      conflictingFields: best?.result.conflictingFields ?? [],
      proposedAction: best?.result.proposedAction ?? "No matching live exercise found — genuinely new content newExerciseImporter should have already picked up; if it appears here, investigate why it didn't (see importer's own SAFE_TO_CREATE_DECISIONS filter).",
      bestMatchExercise: best ? { id: best.candidate.id, name: best.candidate.name, referenceCount: refCounts.get(best.candidate.id) ?? 0 } : null,
      reviewStatus: (reviewDecision?.decision as ReviewDecisionKind) ?? "PENDING",
      reviewedAt: reviewDecision?.updatedAt?.toISOString() ?? null,
      reviewNote: reviewDecision?.note ?? null,
    };
  });

  const summary: Record<string, number> = {
    total: candidates.length,
    PENDING: candidates.filter((c) => c.reviewStatus === "PENDING").length,
    LIKELY_DUPLICATE: candidates.filter((c) => c.duplicateDecision === "LIKELY_DUPLICATE").length,
    MANUAL_REVIEW: candidates.filter((c) => c.duplicateDecision === "MANUAL_REVIEW").length,
    POSSIBLE_VARIANT: candidates.filter((c) => c.duplicateDecision === "POSSIBLE_VARIANT").length,
    DISTINCT: candidates.filter((c) => c.duplicateDecision === "DISTINCT").length,
  };

  if (filters.status === "PENDING") candidates = candidates.filter((c) => c.reviewStatus === "PENDING");
  if (filters.status === "REVIEWED") candidates = candidates.filter((c) => c.reviewStatus !== "PENDING");
  if (filters.decisionTier) candidates = candidates.filter((c) => c.duplicateDecision === filters.decisionTier);
  if (filters.search) {
    const q = normalizeVietnamese(filters.search);
    candidates = candidates.filter(
      (c) => normalizeVietnamese(c.nameEn).includes(q) || normalizeVietnamese(c.nameVi).includes(q),
    );
  }

  // Most-confident/highest-risk-of-being-a-real-duplicate first — that's
  // the set a reviewer most needs to look at before anything gets
  // imported as a "new" exercise that might actually be a duplicate.
  candidates.sort((a, b) => b.confidence - a.confidence);

  return { candidates, summary };
}

export interface ReviewCandidateDetail extends ReviewCandidateSummary {
  catalogRow: CatalogRow;
  bestMatchExerciseDetail: {
    id: string;
    exerciseName: string;
    typeOfEquipment: string;
    bodyPart: string;
    muscleGroupsActivated: string[];
    instructions: string;
    videoUrl: string | null;
    status: string;
  } | null;
  reviewHistory: Array<{ decision: string; note: string | null; createdAt: string; updatedAt: string }>;
}

export async function getReviewCandidateDetail(externalRef: string): Promise<ReviewCandidateDetail | null> {
  const { rows: catalog } = loadCatalog();
  const row = catalog.find((r) => r.externalId === externalRef);
  if (!row) return null;

  const resolved = await loadResolvedExternalRefs();
  if (resolved.has(externalRef)) return null; // already resolved — not a pending candidate anymore

  const live = await loadLiveExercises();
  const best = findBestMatch(row, live);

  const history = await prisma.exerciseReviewDecision.findMany({
    where: { externalRef, source: SOURCE },
    orderBy: { createdAt: "asc" },
  });
  const reviewDecision = history[history.length - 1] ?? null;

  let bestMatchExerciseDetail: ReviewCandidateDetail["bestMatchExerciseDetail"] = null;
  let referenceCount = 0;
  if (best) {
    const full = await prisma.exercise.findUnique({ where: { id: best.candidate.id } });
    if (full) {
      bestMatchExerciseDetail = {
        id: full.id,
        exerciseName: full.exerciseName,
        typeOfEquipment: full.typeOfEquipment,
        bodyPart: full.bodyPart,
        muscleGroupsActivated: full.muscleGroupsActivated,
        instructions: full.instructions,
        videoUrl: full.videoUrl,
        status: full.status,
      };
      const counts = await referenceCountByExerciseId([full.id]);
      referenceCount = counts.get(full.id) ?? 0;
    }
  }

  return {
    externalRef: row.externalId,
    nameEn: row.nameEn,
    nameVi: row.nameVi,
    movementPattern: row.movementPattern,
    equipment: row.equipment,
    primaryMuscles: row.primaryMuscles,
    duplicateDecision: best?.result.decision ?? "DISTINCT",
    confidence: best?.result.confidence ?? 0,
    matchedFields: best?.result.matchedFields ?? [],
    conflictingFields: best?.result.conflictingFields ?? [],
    proposedAction: best?.result.proposedAction ?? "No matching live exercise found.",
    bestMatchExercise: best ? { id: best.candidate.id, name: best.candidate.name, referenceCount } : null,
    reviewStatus: (reviewDecision?.decision as ReviewDecisionKind) ?? "PENDING",
    reviewedAt: reviewDecision?.updatedAt?.toISOString() ?? null,
    reviewNote: reviewDecision?.note ?? null,
    catalogRow: row,
    bestMatchExerciseDetail,
    reviewHistory: history.map((h) => ({
      decision: h.decision,
      note: h.note,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    })),
  };
}

/** The FULL decision history for one candidate, oldest first — a
 * standalone endpoint (separate from getReviewCandidateDetail, which
 * already embeds this) for a reviewer who specifically wants to audit
 * "who decided what, and when" without re-fetching the whole detail view. */
export async function getReviewHistory(
  externalRef: string,
): Promise<Array<{ decision: string; note: string | null; reviewerId: string | null; createdAt: string }>> {
  const rows = await prisma.exerciseReviewDecision.findMany({
    where: { externalRef, source: SOURCE },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((h) => ({
    decision: h.decision,
    note: h.note,
    reviewerId: h.reviewerId,
    createdAt: h.createdAt.toISOString(),
  }));
}

export class ReviewValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

export class ReviewConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ReviewConflictError";
  }
}

export interface SubmitDecisionInput {
  externalRef: string;
  decision: ReviewDecisionKind;
  targetExerciseId?: string;
  note?: string;
  reviewerId?: string;
}

export interface SubmitDecisionResult {
  externalRef: string;
  decision: ReviewDecisionKind;
  createdExerciseId: string | null;
  targetExerciseId: string | null;
  alreadyDecided: boolean;
}

/**
 * Applies one human review decision. Idempotent per (externalRef, source):
 *   - Resubmitting the exact SAME decision again is a no-op that returns
 *     the original result (alreadyDecided: true) — never creates a second
 *     exercise/alias, never a second decision row.
 *   - Resubmitting a DIFFERENT decision after a MUTATING one (APPROVE_AS_
 *     NEW_STAGING / LINK_AS_ALIAS_OF_EXISTING) is refused (409) — changing
 *     your mind after real data was already created is a distinct,
 *     separate action (undo/rollback), not a plain re-decision, and this
 *     service never silently deletes what a prior decision created.
 *   - Resubmitting a DIFFERENT non-mutating decision (MARK_AS_DUPLICATE_
 *     SKIP / NEEDS_MORE_INFO / REJECT_RECORD) freely overwrites — no real
 *     data was ever created, so there's nothing unsafe about a reviewer
 *     changing their mind before actually acting.
 */
export async function submitReviewDecision(input: SubmitDecisionInput): Promise<SubmitDecisionResult> {
  if (!VALID_DECISIONS.has(input.decision)) {
    throw new ReviewValidationError(`decision must be one of: ${[...VALID_DECISIONS].join(", ")}`);
  }
  if (input.decision === "LINK_AS_ALIAS_OF_EXISTING" && !input.targetExerciseId) {
    throw new ReviewValidationError("targetExerciseId is required for LINK_AS_ALIAS_OF_EXISTING");
  }
  if (NOTE_REQUIRED_DECISIONS.has(input.decision) && !input.note) {
    throw new ReviewValidationError("note is required for this decision — explain the reasoning behind it");
  }

  const { rows: catalog } = loadCatalog();
  const row = catalog.find((r) => r.externalId === input.externalRef);
  if (!row) {
    throw new ReviewValidationError(`Unknown externalRef: ${input.externalRef} — not found in the current catalog`);
  }

  const resolved = await loadResolvedExternalRefs();
  const existing = await prisma.exerciseReviewDecision.findFirst({
    where: { externalRef: input.externalRef, source: SOURCE },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    if (existing.decision === input.decision) {
      return {
        externalRef: input.externalRef,
        decision: input.decision,
        createdExerciseId: existing.createdExerciseId,
        targetExerciseId: existing.targetExerciseId,
        alreadyDecided: true,
      };
    }
    if (DATA_MUTATING_DECISIONS.has(existing.decision as ReviewDecisionKind)) {
      throw new ReviewConflictError(
        `externalRef ${input.externalRef} already has a MUTATING decision (${existing.decision}) recorded — changing it requires a separate, explicit reversal, not a plain resubmit. This service never silently undoes a prior decision's real effect.`,
      );
    }
  }

  if (resolved.has(input.externalRef) && input.decision !== "MARK_AS_DUPLICATE_SKIP") {
    // Genuinely already resolved by some OTHER path (e.g. the batch
    // importers ran again since this queue was last viewed) — don't let a
    // stale review UI create a second link.
    throw new ReviewConflictError(
      `externalRef ${input.externalRef} already has a real ExerciseSource link — it is no longer a pending candidate. Refresh the review queue.`,
    );
  }

  const candidateSnapshot = {
    catalogRow: row,
    bestMatch: findBestMatch(row, await loadLiveExercises()),
  };
  const duplicateDecisionAtReview = candidateSnapshot.bestMatch?.result.decision ?? "DISTINCT";

  let createdExerciseId: string | null = null;
  let targetExerciseId: string | null = null;

  if (input.decision === "APPROVE_AS_NEW_STAGING") {
    const created = await createStagingExerciseFromCatalogRow(row);
    if (!created.ok) {
      throw new ReviewValidationError(`Could not create exercise: ${created.error}`);
    }
    createdExerciseId = created.exerciseId;
  } else if (input.decision === "LINK_AS_ALIAS_OF_EXISTING") {
    const targetId = input.targetExerciseId!;
    const target = await prisma.exercise.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
    if (!target) {
      throw new ReviewValidationError(`targetExerciseId ${targetId} does not exist`);
    }
    targetExerciseId = targetId;
    const aliasNormalized = normalizeVietnamese(row.nameVi);
    const [existingAlias, existingSource] = await Promise.all([
      prisma.exerciseAlias.findFirst({ where: { exerciseId: targetId, language: "vi", aliasNormalized } }),
      prisma.exerciseSource.findFirst({ where: { exerciseId: targetId, sourceName: SOURCE, externalId: row.externalId } }),
    ]);
    if (!existingAlias) {
      await prisma.exerciseAlias.create({
        data: {
          exerciseId: targetId,
          language: "vi",
          alias: row.nameVi,
          aliasNormalized,
          aliasType: "localized_name",
          source: SOURCE,
        },
      });
    }
    if (!existingSource) {
      await prisma.exerciseSource.create({
        data: {
          exerciseId: targetId,
          sourceName: SOURCE,
          externalId: row.externalId,
          dataLicense: "original_curated",
          sourceVersion: "gate7-review",
          rawHash: crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex"),
        },
      });
    }
  }
  // MARK_AS_DUPLICATE_SKIP / NEEDS_MORE_INFO / REJECT_RECORD: no mutation.

  // Append-only insert — see the model's doc comment. Idempotency (no
  // duplicate row for a repeated identical decision) was already handled
  // above via the `existing.decision === input.decision` early return.
  await prisma.exerciseReviewDecision.create({
    data: {
      externalRef: input.externalRef,
      source: SOURCE,
      decision: input.decision,
      targetExerciseId,
      createdExerciseId,
      note: input.note ?? null,
      duplicateDecisionAtReview,
      candidateSnapshot: candidateSnapshot as any,
      reviewerId: input.reviewerId ?? null,
    },
  });

  return {
    externalRef: input.externalRef,
    decision: input.decision,
    createdExerciseId,
    targetExerciseId,
    alreadyDecided: false,
  };
}
