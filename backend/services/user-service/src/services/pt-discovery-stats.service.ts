import { Prisma } from "../generated/prisma";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/profile.repository";
import { availabilityService } from "./availability.service";
import { computeFromPricesByMode } from "./pt-public-dto";
import { trackJob } from "../lifecycle";

export const PT_DISCOVERY_STATS_BATCH_SIZE = 500;
export const PT_DISCOVERY_STATS_INTERVAL_MS = 5 * 60 * 1000;
export const PT_DISCOVERY_EPOCH_KEEP_MINUTES = 30;
export const PT_DISCOVERY_STUCK_BUILDING_MINUTES = 30;

// Plan §E quality ranking constants
export const BAYES_PRIOR_RATING = 4.2;
export const BAYES_PRIOR_WEIGHT = 10;
export const COMPLETENESS_ITEM_COUNT = 6;
export const COMPLETENESS_MIN_BIO_CHARS = 50;
export const AVAILABILITY_LOOKAHEAD_DAYS = 7;
export const AVAILABILITY_SATURATION_HOURS = 20;
export const NEW_TRAINER_WINDOW_DAYS = 60;

export const QUALITY_WEIGHTS = {
  rating: 0.45,
  completeness: 0.2,
  availability: 0.15,
  accepting: 0.1,
  newTrainer: 0.1,
} as const;

const ADVISORY_LOCK_NS = 20261110;
const ADVISORY_LOCK_KEY = 1;

export interface BuildDiscoveryStatsBatchContext {
  epoch: number;
  batchIndex: number;
  ptUserIds: string[];
}

export interface BuildDiscoveryStatsOptions {
  batchSize?: number;
  now?: () => Date;
  /** Optional logger override (defaults to shared logger). */
  log?: { info: (msg: string) => void };
  /** Optional hook before inserting a batch of stats rows (used in tests to inject batch failures). */
  onBatchBeforeInsert?: (ctx: BuildDiscoveryStatsBatchContext) => void | Promise<void>;
}

export interface BuildDiscoveryStatsResult {
  built: boolean;
  epoch: number | null;
  ptCount: number;
  durationMs: number;
  reason?: "LOCK_CONTENDED" | "BUILDING_IN_PROGRESS";
}

interface CandidatePtRow {
  pt_user_id: string;
  application_id: string;
  specialties: string[];
  accepting: boolean;
  professional_bio: string | null;
  approved_at: Date | null;
}

interface BatchReviewAggRow {
  pt_user_id: string;
  rating_sum: number;
  rating_count: number;
}

interface BatchPackageRow {
  pt_user_id: string;
  session_count: number;
  price: number;
  session_mode: string;
}

interface ComputedStatRow {
  epoch: number;
  ptUserId: string;
  ratingAvg: number | null;
  ratingCount: number;
  bayesRating: number;
  completeness: number;
  availableHours7d: number;
  accepting: boolean;
  approvedAt: Date | null;
  fromPriceOverall: number | null;
  fromPriceOnline: number | null;
  fromPriceOffline: number | null;
  quality: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function computeBayesRating(ratingSum: number, ratingCount: number): number {
  return (BAYES_PRIOR_WEIGHT * BAYES_PRIOR_RATING + ratingSum) / (BAYES_PRIOR_WEIGHT + ratingCount);
}

export function computeNewTrainerBoost(approvedAt: Date | null, now: Date): number {
  if (!approvedAt) return 0;
  const ageDays = Math.max(0, (now.getTime() - approvedAt.getTime()) / 86_400_000);
  return clamp01(1 - ageDays / NEW_TRAINER_WINDOW_DAYS);
}

/**
 * Computes the 7-day availability window using the exact same local calendar logic as
 * `availabilityService.countAvailableSlotsForPT(..., 60, 7)` (availability.service.ts:685-691).
 */
export function resolveAvailability7dWindow(referenceNow: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(referenceNow);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + AVAILABILITY_LOOKAHEAD_DAYS - 1);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

async function claimBuildEpoch(): Promise<{ epoch: number | null; reason?: "LOCK_CONTENDED" | "BUILDING_IN_PROGRESS" }> {
  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ acquired: boolean }[]>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_NS}::int4, ${ADVISORY_LOCK_KEY}::int4) AS acquired
    `);
    if (!lockRows[0]?.acquired) {
      return { epoch: null, reason: "LOCK_CONTENDED" };
    }

    // Reclaim stale crashed BUILDING rows older than 30 minutes before checking active builds.
    await tx.$executeRaw`
      DELETE FROM pt_discovery_epochs
      WHERE status = 'BUILDING'::"PtDiscoveryEpochStatus"
        AND created_at < NOW() - INTERVAL '30 minutes'
    `;

    const activeBuilding = await tx.$queryRaw<{ epoch: number }[]>(Prisma.sql`
      SELECT epoch
      FROM pt_discovery_epochs
      WHERE status = 'BUILDING'::"PtDiscoveryEpochStatus"
      ORDER BY epoch DESC
      LIMIT 1
    `);
    if (activeBuilding.length > 0) {
      return { epoch: null, reason: "BUILDING_IN_PROGRESS" };
    }

    const inserted = await tx.$queryRaw<{ epoch: number }[]>(Prisma.sql`
      INSERT INTO pt_discovery_epochs (status, is_current)
      VALUES ('BUILDING'::"PtDiscoveryEpochStatus", false)
      RETURNING epoch
    `);
    return { epoch: inserted[0].epoch };
  });
}

async function fetchCandidateBatch(afterUserId: string | null, batchSize: number): Promise<CandidatePtRow[]> {
  return prisma.$queryRaw<CandidatePtRow[]>(Prisma.sql`
    SELECT
      p."userId" AS pt_user_id,
      pa.id AS application_id,
      COALESCE(p.specialties, ARRAY[]::text[]) AS specialties,
      p.is_accepting_clients AS accepting,
      pa.professional_bio,
      pa.approved_at
    FROM user_profiles p
    JOIN pt_applications pa ON pa.user_profile_id = p.id
    WHERE p."isPT" = true
      AND p.pt_suspended = false
      AND pa.status = 'APPROVED'::"PTApplicationStatus"
      AND NOT EXISTS (
        SELECT 1 FROM pt_restrictions r
        WHERE r.pt_user_id = p."userId"
          AND r.ended_at IS NULL
          AND r.scope = 'ACCOUNT'::"PtRestrictionScope"
      )
      AND ${afterUserId === null ? Prisma.sql`TRUE` : Prisma.sql`p."userId" > ${afterUserId}`}
    ORDER BY p."userId" ASC
    LIMIT ${batchSize}
  `);
}

async function computeBatchStats(
  epoch: number,
  candidates: CandidatePtRow[],
  availWindow: { from: Date; to: Date },
  now: Date,
): Promise<ComputedStatRow[]> {
  const ptUserIds = candidates.map((c) => c.pt_user_id);
  const applicationIds = candidates.map((c) => c.application_id);

  const [reviewRows, packageRows, certRows, photoRows, availRows, slotCounts] = await Promise.all([
    prisma.$queryRaw<BatchReviewAggRow[]>(Prisma.sql`
      SELECT
        s.pt_user_id,
        COALESCE(SUM(r.rating), 0)::double precision AS rating_sum,
        COUNT(*)::int AS rating_count
      FROM session_reviews r
      JOIN sessions s ON s.id = r.session_id
      WHERE s.pt_user_id = ANY(${ptUserIds}::text[])
      GROUP BY s.pt_user_id
    `),
    prisma.$queryRaw<BatchPackageRow[]>(Prisma.sql`
      SELECT
        pkg.pt_user_id,
        pkg.session_count,
        pkg.price::double precision AS price,
        pkg.session_mode::text AS session_mode
      FROM pt_service_packages pkg
      WHERE pkg.pt_user_id = ANY(${ptUserIds}::text[])
        AND pkg.is_active = true
        AND pkg.archived_at IS NULL
        AND pkg.session_count >= 1
        AND pkg.price > 0
    `),
    prisma.$queryRaw<{ application_id: string }[]>(Prisma.sql`
      SELECT DISTINCT c.application_id
      FROM pt_application_certificates c
      WHERE c.application_id = ANY(${applicationIds}::text[])
    `),
    prisma.$queryRaw<{ pt_user_id: string }[]>(Prisma.sql`
      SELECT DISTINCT pp.pt_user_id
      FROM pt_physique_photos pp
      WHERE pp.pt_user_id = ANY(${ptUserIds}::text[])
        AND pp.status = 'PUBLISHED'::"PtPhysiquePhotoStatus"
    `),
    prisma.$queryRaw<{ pt_user_id: string }[]>(Prisma.sql`
      SELECT DISTINCT av.pt_user_id
      FROM pt_availability av
      WHERE av.pt_user_id = ANY(${ptUserIds}::text[])
        AND av.is_active = true
    `),
    availabilityService.countAvailableSlotsForPTs(ptUserIds, availWindow.from, availWindow.to, 60),
  ]);

  const reviewsByPt = new Map(reviewRows.map((r) => [r.pt_user_id, r]));
  const packagesByPt = new Map<string, BatchPackageRow[]>();
  for (const pkg of packageRows) {
    const list = packagesByPt.get(pkg.pt_user_id);
    if (list) list.push(pkg);
    else packagesByPt.set(pkg.pt_user_id, [pkg]);
  }
  const certAppSet = new Set(certRows.map((r) => r.application_id));
  const photoPtSet = new Set(photoRows.map((r) => r.pt_user_id));
  const availPtSet = new Set(availRows.map((r) => r.pt_user_id));

  return candidates.map((pt) => {
    const rev = reviewsByPt.get(pt.pt_user_id);
    const ratingCount = rev?.rating_count ?? 0;
    const ratingSum = rev?.rating_sum ?? 0;
    const ratingAvg = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;
    const bayesRating = computeBayesRating(ratingSum, ratingCount);
    const rHat = clamp01((bayesRating - 1) / 4);

    // 6 binary completeness items (Q4; excludes avatar; specialty reads user_profiles.specialties only)
    const completenessScore =
      ((pt.professional_bio ?? "").trim().length >= COMPLETENESS_MIN_BIO_CHARS ? 1 : 0) +
      (pt.specialties.length >= 1 ? 1 : 0) +
      (certAppSet.has(pt.application_id) ? 1 : 0) +
      (photoPtSet.has(pt.pt_user_id) ? 1 : 0) +
      ((packagesByPt.get(pt.pt_user_id)?.length ?? 0) >= 1 ? 1 : 0) +
      (availPtSet.has(pt.pt_user_id) ? 1 : 0);
    const completeness = completenessScore / COMPLETENESS_ITEM_COUNT;

    const availableHours7d = slotCounts[pt.pt_user_id] ?? 0;
    const aHat = clamp01(availableHours7d / AVAILABILITY_SATURATION_HOURS);
    const acc = pt.accepting ? 1 : 0;
    const nw = computeNewTrainerBoost(pt.approved_at, now);

    const quality = clamp01(
      QUALITY_WEIGHTS.rating * rHat +
        QUALITY_WEIGHTS.completeness * completeness +
        QUALITY_WEIGHTS.availability * aHat +
        QUALITY_WEIGHTS.accepting * acc +
        QUALITY_WEIGHTS.newTrainer * nw,
    );

    const pkgs = (packagesByPt.get(pt.pt_user_id) ?? []).map((p) => ({
      price: p.price,
      sessionCount: p.session_count,
      sessionMode: p.session_mode,
    }));
    const prices = computeFromPricesByMode(pkgs);

    return {
      epoch,
      ptUserId: pt.pt_user_id,
      ratingAvg,
      ratingCount,
      bayesRating,
      completeness,
      availableHours7d,
      accepting: pt.accepting,
      approvedAt: pt.approved_at,
      fromPriceOverall: prices.overall.fromPricePerSession,
      fromPriceOnline: prices.online.fromPricePerSession,
      fromPriceOffline: prices.offline.fromPricePerSession,
      quality,
    };
  });
}

async function insertBatchStats(rows: ComputedStatRow[]): Promise<void> {
  if (rows.length === 0) return;
  const tuples = rows.map(
    (r) => Prisma.sql`(
      ${r.epoch}::int4,
      ${r.ptUserId}::text,
      ${r.ratingAvg}::double precision,
      ${r.ratingCount}::int4,
      ${r.bayesRating}::double precision,
      ${r.completeness}::double precision,
      ${r.availableHours7d}::double precision,
      ${r.accepting}::boolean,
      ${r.approvedAt}::timestamptz,
      ${r.fromPriceOverall}::numeric(14,2),
      ${r.fromPriceOnline}::numeric(14,2),
      ${r.fromPriceOffline}::numeric(14,2),
      ${r.quality}::double precision
    )`,
  );

  await prisma.$executeRaw`
    INSERT INTO pt_discovery_stats (
      epoch,
      pt_user_id,
      rating_avg,
      rating_count,
      bayes_rating,
      completeness,
      available_hours_7d,
      accepting,
      approved_at,
      from_price_overall,
      from_price_online,
      from_price_offline,
      quality
    )
    VALUES ${Prisma.join(tuples, ", ")}
  `;
}

async function promoteEpochToCurrent(epoch: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE pt_discovery_epochs SET is_current = false WHERE is_current = true`;
    await tx.$executeRaw`
      UPDATE pt_discovery_epochs
      SET status = 'READY'::"PtDiscoveryEpochStatus",
          is_current = true,
          ready_at = NOW()
      WHERE epoch = ${epoch}
    `;
  });
}

export async function pruneExpiredDiscoveryEpochs(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM pt_discovery_epochs
    WHERE (
      status = 'READY'::"PtDiscoveryEpochStatus"
      AND is_current = false
      AND COALESCE(ready_at, created_at) < NOW() - INTERVAL '30 minutes'
    ) OR (
      status = 'BUILDING'::"PtDiscoveryEpochStatus"
      AND created_at < NOW() - INTERVAL '30 minutes'
    )
  `;
}

/**
 * Rebuilds a full `pt_discovery_stats` snapshot in a fresh epoch (batched 500 PTs at a time) and
 * swaps `is_current` atomically only once every batch succeeds.
 */
export async function buildDiscoveryStatsEpoch(
  options: BuildDiscoveryStatsOptions = {},
): Promise<BuildDiscoveryStatsResult> {
  const startedAt = Date.now();
  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? PT_DISCOVERY_STATS_BATCH_SIZE));
  const nowFn = options.now ?? (() => new Date());

  const claimed = await claimBuildEpoch();
  if (claimed.epoch === null) {
    return {
      built: false,
      epoch: null,
      ptCount: 0,
      durationMs: Date.now() - startedAt,
      reason: claimed.reason,
    };
  }

  const epoch = claimed.epoch;
  const referenceNow = nowFn();
  const availWindow = resolveAvailability7dWindow(referenceNow);
  let afterUserId: string | null = null;
  let batchIndex = 0;
  let totalPts = 0;

  try {
    while (true) {
      const candidates = await fetchCandidateBatch(afterUserId, batchSize);
      if (candidates.length === 0) break;

      const ptUserIds = candidates.map((c) => c.pt_user_id);
      if (options.onBatchBeforeInsert) {
        await options.onBatchBeforeInsert({ epoch, batchIndex, ptUserIds });
      }

      const statRows = await computeBatchStats(epoch, candidates, availWindow, referenceNow);
      await insertBatchStats(statRows);

      totalPts += candidates.length;
      afterUserId = candidates[candidates.length - 1].pt_user_id;
      batchIndex += 1;
      if (candidates.length < batchSize) break;
    }

    await promoteEpochToCurrent(epoch);
    await pruneExpiredDiscoveryEpochs();

    const durationMs = Date.now() - startedAt;
    (options.log ?? logger).info(`[PtDiscoveryStats] built epoch=${epoch} ptCount=${totalPts} durationMs=${durationMs}`);
    return { built: true, epoch, ptCount: totalPts, durationMs };
  } catch (err) {
    // Roll back failed BUILDING epoch (CASCADE removes partial pt_discovery_stats rows); never touch current READY epoch.
    await prisma.$executeRaw`
      DELETE FROM pt_discovery_epochs
      WHERE epoch = ${epoch}
        AND status = 'BUILDING'::"PtDiscoveryEpochStatus"
    `.catch(() => {});
    throw err;
  }
}

let jobRunning = false;

export function isPtDiscoveryStatsJobEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PT_DISCOVERY_STATS_JOB_ENABLED === "false") return false;
  const inTest = env.NODE_ENV === "test" || env.GYMINI_TEST_ISOLATION === "1";
  if (inTest && env.PT_DISCOVERY_STATS_JOB_ENABLED !== "true") return false;
  return true;
}

export async function runPtDiscoveryStatsJobOnce(
  options: BuildDiscoveryStatsOptions = {},
): Promise<BuildDiscoveryStatsResult | null> {
  if (jobRunning) return null;
  jobRunning = true;
  try {
    return await buildDiscoveryStatsEpoch(options);
  } finally {
    jobRunning = false;
  }
}

/**
 * Starts the 5-minute `pt_discovery_stats` rebuild job and performs a non-blocking initial build
 * if no current `READY` epoch exists yet. Returns a stop function for graceful shutdown.
 */
export function startPtDiscoveryStatsJob(): () => void {
  if (!isPtDiscoveryStatsJobEnabled()) {
    return () => {};
  }

  logger.info(`PT discovery stats job started (interval: ${Math.round(PT_DISCOVERY_STATS_INTERVAL_MS / 60000)} min)`);

  void trackJob(
    prisma.ptDiscoveryEpoch
      .findFirst({ where: { isCurrent: true, status: "READY" }, select: { epoch: true } })
      .then((current) => {
        if (!current) return runPtDiscoveryStatsJobOnce();
        return null;
      })
      .catch((err) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "[PtDiscoveryStats] startup build failed");
      }),
  );

  const timer = setInterval(() => {
    void trackJob(
      runPtDiscoveryStatsJobOnce().catch((err) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "[PtDiscoveryStats] periodic build failed");
      }),
    );
  }, PT_DISCOVERY_STATS_INTERVAL_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}
