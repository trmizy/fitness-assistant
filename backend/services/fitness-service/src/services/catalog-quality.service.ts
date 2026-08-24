/**
 * Roadmap P1.8 "Logging-mode catalog discoverability"
 * (docs/features/CATALOG_QUALITY_MATRIX_IMPACT_ANALYSIS.md).
 *
 * P0 proved TIME_LOAD works technically, but its 3 catalog rows are still
 * STAGING. The roadmap's own instruction is explicit: "Do not publish rows
 * just to claim feature availability" — before any status change, inspect
 * why rows are staging, audit licensing/provenance, verify classification,
 * verify instructions/media, and (this file) "create a catalog quality
 * matrix" so that decision can be made with real data, for the WHOLE
 * catalog's STAGING backlog, not just TIME_LOAD's 3 rows.
 *
 * This deliberately does NOT add a "flip status to PUBLISHED" endpoint —
 * no such admin action exists anywhere in this codebase today (the 883
 * pre-existing rows were backfilled once via a one-off script, see
 * exercise.service.ts's own comment), and this pass's own audit found a
 * real, load-bearing publish gate already implicit in the data: within the
 * `original_curated` cohort, `video_url` presence is a near-perfect
 * predictor of publish status (25/26 published rows have it, 119/119
 * staging rows don't) — adding a status-flip action without also solving
 * media would just be a shortcut around that established bar. See the
 * impact analysis's "Real findings" section.
 */
import { prisma } from "../repositories/prisma";
import { boundedInt } from "./exercise.service";

export interface CatalogQualityRow {
  id: string;
  exerciseName: string;
  loggingMode: string;
  publicationStatus: string;
  equipment: string;
  muscles: string[];
  hasVideo: boolean;
  dataLicense: string | null;
  mediaLicense: string | null;
  sourceName: string | null;
  reviewStatus: string;
}

export interface CatalogQualitySummary {
  total: number;
  byPublicationStatus: Record<string, number>;
  byLoggingMode: Record<string, number>;
  missingVideo: number;
  missingMediaLicense: number;
  noReviewRecord: number;
}

export interface CatalogQualityMatrixResult {
  rows: CatalogQualityRow[];
  pagination: { page: number; limit: number; total: number };
  summary: CatalogQualitySummary;
}

/** "Has this exercise's import ever received an explicit human decision?"
 * Gate 7's `ExerciseReviewDecision` is keyed by (source, externalRef), the
 * SAME pair `ExerciseSource` links onto an Exercise — join through that,
 * not through Exercise.id directly (ExerciseReviewDecision never stores
 * one). An exercise can have zero, one, or (rarely) multiple ExerciseSource
 * rows; this reports the review status of whichever source row resolves
 * one, preferring one that actually has a decision on file. */
async function loadReviewStatusByExerciseId(exerciseIds: string[]): Promise<Map<string, string>> {
  if (exerciseIds.length === 0) return new Map();
  const sources = await prisma.exerciseSource.findMany({
    where: { exerciseId: { in: exerciseIds } },
    select: { exerciseId: true, sourceName: true, externalId: true },
  });
  const exerciseIdsWithSource = new Set(sources.map((s) => s.exerciseId));

  const pairs = sources.filter((s) => s.externalId);
  const decisions =
    pairs.length === 0
      ? []
      : await prisma.exerciseReviewDecision.findMany({
          where: {
            OR: [...new Set(pairs.map((p) => p.sourceName))].map((sourceName) => ({
              source: sourceName,
              externalRef: { in: pairs.filter((p) => p.sourceName === sourceName).map((p) => p.externalId as string) },
            })),
          },
          orderBy: { createdAt: "asc" },
          select: { source: true, externalRef: true, decision: true },
        });
  const latestDecisionByKey = new Map<string, string>();
  for (const d of decisions) latestDecisionByKey.set(`${d.source}|${d.externalRef}`, d.decision); // asc order — last write wins

  const result = new Map<string, string>();
  for (const s of sources) {
    if (result.has(s.exerciseId)) continue; // keep the first source row's status if an exercise somehow has >1
    const key = s.externalId ? `${s.sourceName}|${s.externalId}` : null;
    result.set(s.exerciseId, (key && latestDecisionByKey.get(key)) || "NO_REVIEW_RECORD");
  }
  for (const id of exerciseIds) {
    if (!exerciseIdsWithSource.has(id)) result.set(id, "NO_SOURCE_RECORD");
  }
  return result;
}

export async function getCatalogQualityMatrix(filters: {
  loggingMode?: string;
  status?: string;
  search?: string;
  page?: string | number;
  limit?: string | number;
}): Promise<CatalogQualityMatrixResult> {
  const page = boundedInt(filters.page, 1, 1, 10_000);
  const limit = boundedInt(filters.limit, 50, 1, 200);

  const where: any = {};
  if (filters.loggingMode) where.loggingMode = filters.loggingMode;
  if (filters.status) where.status = filters.status;
  if (filters.search) where.exerciseName = { contains: filters.search, mode: "insensitive" };

  const [pageRows, total, allMatchingForSummary] = await Promise.all([
    prisma.exercise.findMany({
      where,
      select: {
        id: true,
        exerciseName: true,
        loggingMode: true,
        status: true,
        typeOfEquipment: true,
        muscleGroupsActivated: true,
        videoUrl: true,
      },
      orderBy: [{ status: "asc" }, { loggingMode: "asc" }, { exerciseName: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.exercise.count({ where }),
    // Summary is computed over the FULL filtered set (not just this page) —
    // a reviewer scoping to loggingMode=TIME_LOAD should see counts for
    // all 3 rows, not just whatever page they're looking at.
    prisma.exercise.findMany({ where, select: { id: true, status: true, loggingMode: true, videoUrl: true } }),
  ]);

  const sourcesByExerciseId = await prisma.exerciseSource.findMany({
    where: { exerciseId: { in: pageRows.map((r) => r.id) } },
    select: { exerciseId: true, sourceName: true, dataLicense: true, mediaLicense: true },
  });
  const sourceMap = new Map(sourcesByExerciseId.map((s) => [s.exerciseId, s]));
  const reviewStatusMap = await loadReviewStatusByExerciseId(pageRows.map((r) => r.id));

  const rows: CatalogQualityRow[] = pageRows.map((r) => {
    const source = sourceMap.get(r.id) ?? null;
    return {
      id: r.id,
      exerciseName: r.exerciseName,
      loggingMode: r.loggingMode,
      publicationStatus: r.status,
      equipment: r.typeOfEquipment,
      muscles: r.muscleGroupsActivated,
      hasVideo: !!r.videoUrl,
      dataLicense: source?.dataLicense ?? null,
      mediaLicense: source?.mediaLicense ?? null,
      sourceName: source?.sourceName ?? null,
      reviewStatus: reviewStatusMap.get(r.id) ?? "NO_SOURCE_RECORD",
    };
  });

  // Summary review-status/media-license counts need the SAME per-exercise
  // source/review lookups as the page, but over the full filtered set —
  // bounded by how many STAGING+PUBLISHED rows exist total (~1000), so one
  // extra batched pass is cheap and still avoids N+1 queries.
  const allIds = allMatchingForSummary.map((r) => r.id);
  const allSources = await prisma.exerciseSource.findMany({
    where: { exerciseId: { in: allIds } },
    select: { exerciseId: true, mediaLicense: true },
  });
  const mediaLicenseByExerciseId = new Map(allSources.map((s) => [s.exerciseId, s.mediaLicense]));
  const allReviewStatusMap = await loadReviewStatusByExerciseId(allIds);

  const byPublicationStatus: Record<string, number> = {};
  const byLoggingMode: Record<string, number> = {};
  let missingVideo = 0;
  let missingMediaLicense = 0;
  let noReviewRecord = 0;
  for (const r of allMatchingForSummary) {
    byPublicationStatus[r.status] = (byPublicationStatus[r.status] ?? 0) + 1;
    byLoggingMode[r.loggingMode] = (byLoggingMode[r.loggingMode] ?? 0) + 1;
    if (!r.videoUrl) missingVideo += 1;
    const mediaLicense = mediaLicenseByExerciseId.get(r.id);
    if (!mediaLicense) missingMediaLicense += 1;
    if (allReviewStatusMap.get(r.id)?.startsWith("NO_")) noReviewRecord += 1;
  }

  return {
    rows,
    pagination: { page, limit, total },
    summary: {
      total: allMatchingForSummary.length,
      byPublicationStatus,
      byLoggingMode,
      missingVideo,
      missingMediaLicense,
      noReviewRecord,
    },
  };
}
