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
import { PT_DISCOVERY_DEFAULT_LIMIT, PT_DISCOVERY_MAX_LIMIT } from "../services/pt-discovery.query";
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

      // Trainers approved before names were copied at approval time still have empty name
      // columns, so `q` cannot find them. Only the current page's nameless rows go to auth-service.
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

      // One grouped query for the current page only, preserving the SQL sort order.
      const rated = await attachPtRatings(profiles as any[]);

      // Phase 1 layer 2 + Phase 2 VĐ6: slots + matchReason for the current page, without re-sorting.
      const enriched = await enrichForDiscovery(
        rated,
        req.user?.id,
        { areaProvince, areaWard },
        activeViewerGymIds,
      );
      // Everything below this line is the public allowlist: rows came from the public finder (visibility rule
      // applied), and only the fields toPublicPtDto names are emitted.
      const signed = await Promise.all(
        (enriched as any[]).map((row) =>
          withSignedProfilePhoto(
            toPublicPtDto(row as PublishedPtSource, {
              avgRating: row.avgRating,
              ratingCount: row.ratingCount,
              availableSlotsNext28Days: row.availableSlotsNext28Days,
              matchReason: row.matchReason,
            }),
          ),
        ),
      );

      res.json({ pts: signed, hasMore });
    } catch (error) {
      logger.error(error, "List PTs error");
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
