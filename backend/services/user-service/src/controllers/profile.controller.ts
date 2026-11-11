import { Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import {
  profileService,
  enrichProfilesWithAuthNames,
  withSignedProfilePhoto,
} from "../services/profile.service";
import { profileRepository, prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import {
  ptReviewRepository,
  attachPtRatings,
} from "../repositories/ptReview.repository";
import { enrichForDiscovery, viewerGymIds } from "../services/pt-discovery.service";
import {
  PT_DISCOVERY_DEFAULT_LIMIT,
  PT_DISCOVERY_MAX_LIMIT,
  type PtSearchPageItem,
} from "../services/pt-discovery.query";
import {
  CursorExpiredError,
  CursorFilterMismatchError,
  CursorSecretUnavailableError,
  InvalidCursorError,
  type DiscoveryMode,
  type DiscoveryScope,
  type DiscoverySortKey,
} from "../services/pt-discovery-cursor";
import { toPublicPtDto, type PublishedPtSource } from "../services/pt-public-dto";
import { auditService, auditMeta } from "../services/audit.service";
import { profileNameFields } from "../utils/profileName.util";
import { AuditEntityType } from "../generated/prisma";
import { adminPTStatusSchema, profileSchema } from "../models/profile.models";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  createProfilePhotoUploadUrl,
  isOwnProfilePhotoKey,
  isS3Ref,
  keyFromS3Ref,
  profilePhotoUrlForKey,
} from "../services/s3-upload.service";
import type { PtSearchQueryInput } from "../services/pt-discovery.query";

const VALID_SEARCH_SCOPES = new Set<DiscoveryScope>(["near", "province", "national"]);
const VALID_SEARCH_MODES = new Set<DiscoveryMode>(["ANY", "ONLINE", "OFFLINE", "HYBRID"]);
const VALID_SEARCH_SORTS = new Set<DiscoverySortKey>([
  "default",
  "distance",
  "ratingDesc",
  "ratingAsc",
  "priceAsc",
  "priceDesc",
  "nameAsc",
]);

function isPositivePgInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 2_147_483_647;
}

function isStatementTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, any>;
  if (e.code === "57014" || e.meta?.code === "57014") return true;
  const msg = String(e.meta?.message ?? e.message ?? "");
  return /statement timeout/i.test(msg);
}

function parseSearchPtsBody(
  raw: unknown,
): { value: PtSearchQueryInput } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Body tìm kiếm phải là JSON object" };
  }
  const b = raw as Record<string, unknown>;

  let lat: number | undefined;
  let lng: number | undefined;
  if (b.lat != null || b.lng != null) {
    if (typeof b.lat !== "number" || !Number.isFinite(b.lat) || typeof b.lng !== "number" || !Number.isFinite(b.lng)) {
      return { error: "lat và lng phải đi cùng nhau và là số hợp lệ" };
    }
    if (b.lat < 8 || b.lat > 24 || b.lng < 102 || b.lng > 110) {
      return { error: "Tọa độ ngoài phạm vi cho phép (lat 8-24, lng 102-110)" };
    }
    lat = b.lat;
    lng = b.lng;
  }

  let radiusKm: number | undefined;
  if (b.radiusKm != null) {
    if (typeof b.radiusKm !== "number" || !Number.isFinite(b.radiusKm) || b.radiusKm < 1 || b.radiusKm > 100) {
      return { error: "radiusKm phải nằm trong khoảng 1-100" };
    }
    radiusKm = b.radiusKm;
  }

  let limit: number | undefined;
  if (b.limit != null) {
    if (typeof b.limit !== "number" || !Number.isSafeInteger(b.limit) || b.limit < 1 || b.limit > PT_DISCOVERY_MAX_LIMIT) {
      return { error: `limit phải là số nguyên trong khoảng 1-${PT_DISCOVERY_MAX_LIMIT}` };
    }
    limit = b.limit;
  }

  let areaProvince: number | undefined;
  if (b.areaProvince != null) {
    if (!isPositivePgInt(b.areaProvince)) return { error: "areaProvince phải là số nguyên dương" };
    areaProvince = b.areaProvince;
  }

  let areaWard: number | undefined;
  if (b.areaWard != null) {
    if (!isPositivePgInt(b.areaWard)) return { error: "areaWard phải là số nguyên dương" };
    if (areaProvince === undefined) return { error: "areaWard phải đi kèm areaProvince" };
    areaWard = b.areaWard;
  }

  let scope: DiscoveryScope | undefined;
  if (b.scope != null) {
    if (typeof b.scope !== "string" || !VALID_SEARCH_SCOPES.has(b.scope as DiscoveryScope)) {
      return { error: "scope không hợp lệ (near | province | national)" };
    }
    scope = b.scope as DiscoveryScope;
    if (scope === "province" && areaProvince === undefined) {
      return { error: "scope='province' phải đi kèm areaProvince" };
    }
  }

  let mode: DiscoveryMode | undefined;
  if (b.mode != null) {
    if (typeof b.mode !== "string" || !VALID_SEARCH_MODES.has(b.mode as DiscoveryMode)) {
      return { error: "mode không hợp lệ (ANY | ONLINE | OFFLINE | HYBRID)" };
    }
    mode = b.mode as DiscoveryMode;
  }

  let sortBy: DiscoverySortKey | undefined;
  if (b.sortBy != null) {
    if (typeof b.sortBy !== "string" || !VALID_SEARCH_SORTS.has(b.sortBy as DiscoverySortKey)) {
      return { error: "sortBy không hợp lệ" };
    }
    sortBy = b.sortBy as DiscoverySortKey;
  }

  let cursor: string | undefined;
  if (b.cursor != null) {
    if (typeof b.cursor !== "string" || b.cursor.trim().length === 0) {
      return { error: "cursor không hợp lệ" };
    }
    cursor = b.cursor;
  }

  let q: string | undefined;
  let specialties: string[] | undefined;
  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  let gymId: string | undefined;
  if (b.filters != null) {
    if (typeof b.filters !== "object" || Array.isArray(b.filters)) {
      return { error: "filters phải là JSON object" };
    }
    const f = b.filters as Record<string, unknown>;
    if (f.q != null) {
      if (typeof f.q !== "string") return { error: "filters.q phải là chuỗi" };
      q = f.q;
    }
    if (f.gymId != null) {
      if (typeof f.gymId !== "string") return { error: "filters.gymId phải là chuỗi" };
      if (f.gymId.trim()) gymId = f.gymId.trim();
    }
    if (f.specialties != null) {
      if (!Array.isArray(f.specialties) || f.specialties.some((s) => typeof s !== "string")) {
        return { error: "filters.specialties phải là mảng chuỗi" };
      }
      const cleaned = f.specialties.map((s) => s.trim()).filter(Boolean);
      if (cleaned.length > 0) specialties = cleaned;
    }
    if (f.minPrice != null) {
      if (typeof f.minPrice !== "number" || !Number.isFinite(f.minPrice) || f.minPrice < 0) {
        return { error: "filters.minPrice phải là số không âm" };
      }
      minPrice = f.minPrice;
    }
    if (f.maxPrice != null) {
      if (typeof f.maxPrice !== "number" || !Number.isFinite(f.maxPrice) || f.maxPrice < 0) {
        return { error: "filters.maxPrice phải là số không âm" };
      }
      maxPrice = f.maxPrice;
    }
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      return { error: "filters.minPrice phải <= filters.maxPrice" };
    }
  }

  return {
    value: {
      lat,
      lng,
      radiusKm,
      areaProvince,
      areaWard,
      scope,
      mode,
      sortBy,
      q,
      specialties,
      minPrice,
      maxPrice,
      gymId,
      cursor,
      limit,
    },
  };
}

/** Shared page hydration (auth-name backfill, rating attach, slots/matchReason, optional distance, allowlisted DTO). */
async function hydrateDiscoveryPublicPts(
  profiles: PublishedPtSource[],
  viewerUserId: string | undefined,
  viewerArea: { areaProvince?: number; areaWard?: number },
  activeViewerGymIds: Set<string>,
  distanceMetaByUserId?: Map<string, PtSearchPageItem>,
) {
  const nameless = new Set((profiles as any[]).filter((p) => !p.firstName && !p.lastName).map((p) => p.userId));
  if (nameless.size > 0) {
    const namelessProfiles = (profiles as any[]).filter((p) => nameless.has(p.userId));
    await enrichProfilesWithAuthNames(namelessProfiles);
    void Promise.all(
      namelessProfiles.map((p) => {
        const names = profileNameFields(p.firstName, p.lastName);
        return names ? profileRepository.backfillNames(p.userId, names) : null;
      }),
    ).catch(() => undefined);
  }

  const rated = await attachPtRatings(profiles as any[]);
  const enriched = await enrichForDiscovery(rated, viewerUserId, viewerArea, activeViewerGymIds);

  return Promise.all(
    (enriched as any[]).map((row) => {
      const distMeta = distanceMetaByUserId?.get(row.userId);
      return withSignedProfilePhoto(
        toPublicPtDto(row as PublishedPtSource, {
          avgRating: row.avgRating,
          ratingCount: row.ratingCount,
          availableSlotsNext28Days: row.availableSlotsNext28Days,
          matchReason: row.matchReason,
          ...(distMeta ? { distanceKm: distMeta.distanceKm, distanceBasis: distMeta.distanceBasis } : {}),
        }),
      );
    }),
  );
}

export const profileController = {
  async getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await profileService.getProfile(req.user!.id);
      res.json(result);
    } catch (error) {
      logger.error(error, "Get profile error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  async upsertProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = profileSchema.parse(req.body);
      // photoUrl is a storage reference, not free text: without this check anyone could point their profile at
      // ANOTHER user's photo (s3://profile-photos/<someone else>/...) and have the server sign it for them.
      // Accepted: an s3 ref under the caller's own prefix, the value already stored (an unchanged re-save, which
      // also covers a legacy non-s3 value), or "" to clear it.
      if (body.photoUrl !== undefined && body.photoUrl !== "") {
        const current = (await profileRepository.findByUserId(req.user!.id))?.photoUrl ?? null;
        let own = false;
        try {
          own = isS3Ref(body.photoUrl) && isOwnProfilePhotoKey(req.user!.id, keyFromS3Ref(body.photoUrl));
        } catch {
          own = false; // an unsafe key (".." etc.) is simply not ours
        }
        if (!own && body.photoUrl !== current) {
          res.status(400).json({
            error: "photoUrl không hợp lệ. Hãy tải ảnh lên bằng chức năng tải ảnh đại diện.",
            code: "PHOTO_URL_NOT_OWNED",
          });
          return;
        }
      }
      const result = await profileService.upsertProfile(req.user!.id, body);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Validation failed", details: error.errors });
        return;
      }
      logger.error(error, "Update profile error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  async uploadPhoto(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const photoUrl = `/uploads/profile-photos/${req.file.filename}`;
      await profileService.upsertProfile(req.user!.id, { photoUrl });
      res.json({ photoUrl });
    } catch (error) {
      logger.error(error, "Upload photo error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  // AWS Lambda deployment prep (docs/features/USER_SERVICE_LAMBDA_IMPACT_ANALYSIS.md,
  // Task 8) — additive S3 presigned-upload alternative to uploadPhoto above.
  // Does not touch/replace the existing local-disk flow.
  async presignPhotoUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const contentType = req.body?.contentType;
      if (typeof contentType !== "string" || !contentType) {
        res.status(400).json({ error: "contentType is required" });
        return;
      }
      const target = await createProfilePhotoUploadUrl(req.user!.id, contentType);
      res.json(target);
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, "Presign photo upload error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  async confirmPhotoUpload(req: AuthRequest, res: Response): Promise<void> {
    try {
      const key = req.body?.key;
      if (typeof key !== "string" || !key) {
        res.status(400).json({ error: "key is required" });
        return;
      }
      if (!isOwnProfilePhotoKey(req.user!.id, key)) {
        res.status(403).json({ error: "key does not belong to this user" });
        return;
      }
      // Same downstream write uploadPhoto already makes — one convergent
      // path for "a profile photo URL was just set", regardless of which
      // upload mechanism produced it.
      const photoUrl = profilePhotoUrlForKey(key);
      const result = await profileService.upsertProfile(req.user!.id, { photoUrl });
      res.json({
        key,
        storedPhotoUrl: photoUrl,
        photoUrl: result.profile?.photoUrl ?? photoUrl,
      });
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, "Confirm photo upload error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  async listPTs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const parseStrictInt = (raw: unknown): number | null => {
        if (typeof raw !== "string") return null;
        const trimmed = raw.trim();
        if (!/^-?\d+$/.test(trimmed)) return null;
        const n = Number(trimmed);
        return Number.isSafeInteger(n) && Math.abs(n) <= 2_147_483_647 ? n : null;
      };

      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      const sessionMode = typeof req.query.sessionMode === "string" ? req.query.sessionMode : undefined;
      const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy.trim() || undefined : undefined;

      let page = 1;
      if (req.query.page !== undefined) {
        const parsedPage = parseStrictInt(req.query.page);
        if (parsedPage === null || parsedPage < 1) {
          res.status(400).json({ error: "page phải là số nguyên >= 1" });
          return;
        }
        page = parsedPage;
      }

      let limit = PT_DISCOVERY_DEFAULT_LIMIT;
      if (req.query.limit !== undefined) {
        if (typeof req.query.limit !== "string") {
          res.status(400).json({ error: "limit phải là số nguyên >= 1" });
          return;
        }
        const trimmedLimit = req.query.limit.trim();
        if (!/^-?\d+$/.test(trimmedLimit)) {
          res.status(400).json({ error: "limit phải là số nguyên >= 1" });
          return;
        }
        const parsedLimit = Number(trimmedLimit);
        if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
          res.status(400).json({ error: "limit phải là số nguyên >= 1" });
          return;
        }
        limit = Math.min(parsedLimit, PT_DISCOVERY_MAX_LIMIT);
      }

      // Parse and validate numeric filters
      let minPrice: number | undefined;
      let maxPrice: number | undefined;
      let provinceCode: number | undefined;
      let wardCode: number | undefined;
      let areaProvince: number | undefined;
      let areaWard: number | undefined;

      if (req.query.minPrice !== undefined) {
        minPrice = Number(req.query.minPrice);
        if (
          typeof req.query.minPrice !== "string" ||
          req.query.minPrice.trim() === "" ||
          !Number.isFinite(minPrice) ||
          minPrice < 0
        ) {
          res.status(400).json({ error: "minPrice phải là số không âm" });
          return;
        }
      }
      if (req.query.maxPrice !== undefined) {
        maxPrice = Number(req.query.maxPrice);
        if (
          typeof req.query.maxPrice !== "string" ||
          req.query.maxPrice.trim() === "" ||
          !Number.isFinite(maxPrice) ||
          maxPrice < 0
        ) {
          res.status(400).json({ error: "maxPrice phải là số không âm" });
          return;
        }
      }
      if (
        minPrice !== undefined &&
        maxPrice !== undefined &&
        minPrice > maxPrice
      ) {
        res.status(400).json({ error: "minPrice phải <= maxPrice" });
        return;
      }
      if (req.query.provinceCode !== undefined) {
        const parsed = parseStrictInt(req.query.provinceCode);
        if (parsed === null) {
          res.status(400).json({ error: "provinceCode phải là số nguyên" });
          return;
        }
        provinceCode = parsed;
      }
      if (req.query.wardCode !== undefined) {
        const parsed = parseStrictInt(req.query.wardCode);
        if (parsed === null) {
          res.status(400).json({ error: "wardCode phải là số nguyên" });
          return;
        }
        wardCode = parsed;
        // A ward code is only meaningful inside a province — the same number is reused
        // across provinces, so filtering on it alone quietly matches wards the caller never
        // meant. The search form already pairs the two; enforcing it only there leaves the
        // rule off entirely for any caller that is not the form.
        if (provinceCode === undefined) {
          res
            .status(400)
            .json({ error: "wardCode phải đi kèm provinceCode" });
          return;
        }
      }
      if (req.query.areaProvince !== undefined) {
        const parsed = parseStrictInt(req.query.areaProvince);
        if (parsed === null) {
          res.status(400).json({ error: "areaProvince phải là số nguyên" });
          return;
        }
        areaProvince = parsed;
      }
      if (req.query.areaWard !== undefined) {
        const parsed = parseStrictInt(req.query.areaWard);
        if (parsed === null) {
          res.status(400).json({ error: "areaWard phải là số nguyên" });
          return;
        }
        areaWard = parsed;
        if (areaProvince === undefined) {
          res
            .status(400)
            .json({ error: "areaWard phải đi kèm areaProvince" });
          return;
        }
      }

      const searchCity = typeof req.query.searchCity === "string" ? req.query.searchCity : undefined;
      const searchDistrict = typeof req.query.searchDistrict === "string" ? req.query.searchDistrict : undefined;
      const gymId = typeof req.query.gymId === "string" ? req.query.gymId : undefined;
      let specialties: string[] | undefined;
      if (req.query.specialties !== undefined) {
        const rawSpecialties = Array.isArray(req.query.specialties)
          ? req.query.specialties.flatMap((v) => String(v).split(","))
          : String(req.query.specialties).split(",");
        const cleaned = rawSpecialties.map((s) => s.trim()).filter(Boolean);
        if (cleaned.length > 0) specialties = cleaned;
      }

      // Fetch viewer's active gyms once before the query so default-order SQL can prioritize
      // SAME_GYM globally and enrichForDiscovery reuses the exact same set for matchReason.
      const activeViewerGymIds = await viewerGymIds(req.user?.id);

      // Global SQL filtering, sorting, and pagination (no limit:1000 JS sort).
      const { pts: profiles, hasMore } = await profileRepository.findPTsPaged({
        q: q?.trim() || undefined,
        minPrice,
        maxPrice,
        sessionMode,
        provinceCode,
        wardCode,
        searchCity,
        searchDistrict,
        gymId,
        specialties,
        sortBy,
        viewerGymIds: activeViewerGymIds.size > 0 ? [...activeViewerGymIds] : undefined,
        page,
        limit,
      });

      const signed = await hydrateDiscoveryPublicPts(profiles, req.user?.id, { areaProvince, areaWard }, activeViewerGymIds);

      res.json({ pts: signed, hasMore });
    } catch (error) {
      logger.error(error, "List PTs error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /** Geo / epoch-cursor PT search via POST body so GPS coordinates never appear on URLs or logs. */
  async searchPTs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const parsed = parseSearchPtsBody(req.body);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error, code: "VALIDATION_ERROR" });
        return;
      }

      const activeViewerGymIds = await viewerGymIds(req.user?.id);
      const { pts: profiles, metaByUserId, nextCursor, hasMore, appliedScope } =
        await profileRepository.searchPTsCursor({
          ...parsed.value,
          viewerGymIds: activeViewerGymIds.size > 0 ? [...activeViewerGymIds] : undefined,
        });

      const signed = await hydrateDiscoveryPublicPts(
        profiles,
        req.user?.id,
        { areaProvince: parsed.value.areaProvince, areaWard: parsed.value.areaWard },
        activeViewerGymIds,
        metaByUserId,
      );

      res.json({ pts: signed, nextCursor, hasMore, appliedScope });
    } catch (err: unknown) {
      if (err instanceof InvalidCursorError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof CursorExpiredError || err instanceof CursorFilterMismatchError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof CursorSecretUnavailableError) {
        logger.error({ code: err.code }, "PT search cursor key missing");
        res.status(err.status).json({ error: "Tìm kiếm tạm thời chưa khả dụng", code: err.code });
        return;
      }
      if (isStatementTimeoutError(err)) {
        // Never log raw error / params in case SQL parameters contain viewer coordinates.
        logger.warn({ code: "QUERY_TIMEOUT" }, "PT search timed out");
        res.status(503).json({ error: "Truy vấn tìm kiếm quá thời gian cho phép", code: "QUERY_TIMEOUT" });
        return;
      }
      logger.error(
        { code: (err as any)?.code ?? null, name: err instanceof Error ? err.name : "Error" },
        "Search PTs error",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /** One PT's public profile, with their rating and the latest commented reviews. */
  async getPTDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      // Same visibility rule as the list (ptPublicWhere): a suspended / restricted / not-approved trainer is a
      // 404 here too, so an id typed into the URL cannot get past the filter the list applies.
      const source = await profileRepository.findPublicPtByUserId(userId);
      if (!source) {
        res.status(404).json({ error: "PT not found" });
        return;
      }

      // A profile row is created lazily and may still lack the name (auth-service has it).
      const named: any = source;
      if (!named.firstName && !named.lastName) await enrichProfilesWithAuthNames([named]);
      const [rating, recentReviews, ratingDistribution] = await Promise.all([
        ptReviewRepository.aggregateForPt(userId),
        ptReviewRepository.recentCommentsForPt(userId, 5),
        ptReviewRepository.ratingDistributionForPt(userId),
      ]);

      res.json({
        ...((await withSignedProfilePhoto(toPublicPtDto(source, rating))) as any),
        recentReviews,
        ratingDistribution,
      });
    } catch (error) {
      logger.error(error, "Get PT detail error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  async becomePT(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await profileService.becomePT(
        req.user!.id,
        req.user!.role,
      );
      res.json(result);
    } catch (error: any) {
      logger.error(error, "Become PT error");
      res.status(error.message?.includes("not allowed") ? 403 : 500).json({
        error: error.message || "Internal server error",
      });
    }
  },

  async deleteProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await profileService.deleteProfile(req.user!.id);
      res.json(result);
    } catch (error) {
      logger.error(error, "Delete profile error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  async adminSetPTStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (req.user?.role !== "ADMIN") {
        res.status(403).json({ error: "Forbidden: admin role required" });
        return;
      }

      const body = adminPTStatusSchema.parse(req.body);
      const result = await profileService.adminSetPTStatus(
        req.params.userId,
        body.isPT,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Validation failed", details: error.errors });
        return;
      }
      logger.error(error, "Admin set PT status error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /** Returns { summary: { [userId]: contractCount } } for all user IDs.
   *  Called by the API Gateway to enrich the admin User Management list.
   */
  async adminContractsSummary(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Defense in depth: the gateway also gates /profile/admin/* behind
      // requireRoles("ADMIN"), but this service must never assume it's
      // unreachable any other way (a misrouted proxy config, a future
      // internal caller, ...) — verify independently.
      if (req.user?.role !== "ADMIN") {
        res.status(403).json({ error: "Forbidden: admin role required" });
        return;
      }
      // Fetch all contracts and group counts in the repository
      // We pass an empty array to get ALL users (repository handles it)
      const allContracts = await contractRepository.findAll(0, 10000);
      const userIds = [
        ...new Set([
          ...allContracts.map((c) => c.ptUserId),
          ...allContracts.map((c) => c.clientUserId),
        ]),
      ];
      const summary = await contractRepository.countByUsers(userIds);
      res.json({ summary });
    } catch (error) {
      logger.error(error, "Admin contracts summary error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /** Returns general system stats for the admin dashboard. */
  async adminGetStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (req.user?.role !== "ADMIN") {
        res.status(403).json({ error: "Forbidden: admin role required" });
        return;
      }
      const activeContracts = await contractRepository.countActive();

      // Calculate OCR stats for the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const inbodyStats = await prisma.inBodyEntry.groupBy({
        by: ["status"],
        where: {
          createdAt: { gte: sevenDaysAgo },
        },
        _count: true,
      });

      const ocrStats = {
        total: inbodyStats.reduce((acc, curr) => acc + curr._count, 0),
        extracted:
          inbodyStats.find((s) => s.status === "extracted")?._count || 0,
        manual: inbodyStats.find((s) => s.status === "manual")?._count || 0,
        pending: inbodyStats.find((s) => s.status === "pending")?._count || 0,
      };

      res.json({ activeContracts, ocrStats });
    } catch (error) {
      logger.error(error, "Admin get stats error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  async toggleAcceptingClients(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { isAcceptingClients, notAcceptingReason } = req.body;
      const { profile } = await profileService.toggleAcceptingClients(
        req.user!.id,
        isAcceptingClients,
        notAcceptingReason
      );

      // Closing the door hides the buy button, so a client who was mid-purchase and a PT
      // who says "I never stopped taking clients" need a dated record of the switch.
      await auditService.record({
        actorUserId: req.user!.id,
        action: isAcceptingClients
          ? "PT_ACCEPTING_CLIENTS_ON"
          : "PT_ACCEPTING_CLIENTS_OFF",
        entityType: AuditEntityType.PT_PROFILE,
        entityId: req.user!.id,
        metadata: { notAcceptingReason: notAcceptingReason ?? null },
        ...auditMeta(req),
      });

      res.json({ profile });
    } catch (error) {
      logger.error(error, "Toggle accepting clients error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
};
