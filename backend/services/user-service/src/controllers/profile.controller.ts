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
import { enrichForDiscovery } from "../services/pt-discovery.service";
import { auditService, auditMeta } from "../services/audit.service";
import { AuditEntityType } from "../generated/prisma";
import { adminPTStatusSchema, profileSchema } from "../models/profile.models";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  createProfilePhotoUploadUrl,
  isOwnProfilePhotoKey,
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
      const q = req.query.q as string | undefined;
      const sessionMode = req.query.sessionMode as string | undefined;
      const sortBy = req.query.sortBy as string | undefined;
      const page = req.query.page
        ? parseInt(req.query.page as string, 10)
        : undefined;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : undefined;

      // Parse and validate numeric filters
      let minPrice: number | undefined;
      let maxPrice: number | undefined;
      let provinceCode: number | undefined;
      let wardCode: number | undefined;

      if (req.query.minPrice !== undefined) {
        minPrice = Number(req.query.minPrice);
        if (isNaN(minPrice) || minPrice < 0) {
          res.status(400).json({ error: "minPrice phải là số không âm" });
          return;
        }
      }
      if (req.query.maxPrice !== undefined) {
        maxPrice = Number(req.query.maxPrice);
        if (isNaN(maxPrice) || maxPrice < 0) {
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
        provinceCode = Number(req.query.provinceCode);
        if (isNaN(provinceCode)) {
          res.status(400).json({ error: "provinceCode phải là số nguyên" });
          return;
        }
      }
      if (req.query.wardCode !== undefined) {
        wardCode = Number(req.query.wardCode);
        if (isNaN(wardCode)) {
          res.status(400).json({ error: "wardCode phải là số nguyên" });
          return;
        }
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

      const searchCity = req.query.searchCity as string | undefined;
      const searchDistrict = req.query.searchDistrict as string | undefined;
      const gymId = req.query.gymId as string | undefined;
      let specialties: string[] | undefined;
      if (req.query.specialties) {
        if (Array.isArray(req.query.specialties)) {
          specialties = req.query.specialties as string[];
        } else {
          specialties = (req.query.specialties as string).split(",");
        }
      }

      // Rating order can't be expressed in findPTs' orderBy (the score is aggregated from
      // session_reviews, not a column), so for that one mode we page in memory: fetch the
      // whole filtered set, attach ratings, sort, then slice. Paging inside the DB and
      // sorting afterwards would only order each page against itself.
      const sortByRating = sortBy === "ratingDesc" || sortBy === "ratingAsc";

      let profiles = await profileRepository.findPTs({
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
        sortBy: sortByRating ? undefined : sortBy,
        page: sortByRating ? undefined : page,
        limit: sortByRating ? 1000 : limit,
      });

      // B10b. Ưu tiên gymId: Nếu có gymId, đưa các PT có cùng gymId lên đầu danh sách
      if (gymId) {
        profiles.sort((a, b) => {
          if (a.gymId === gymId && b.gymId !== gymId) return -1;
          if (b.gymId === gymId && a.gymId !== gymId) return 1;
          return 0;
        });
      }
      await enrichProfilesWithAuthNames(profiles as any[]);

      // One grouped query for the whole list, never one per PT.
      let rated = await attachPtRatings(profiles as any[]);

      if (sortByRating) {
        const dir = sortBy === "ratingAsc" ? 1 : -1;
        // Unrated PTs always sink to the bottom: they are "no rating yet", not "worst".
        rated.sort((a, b) => {
          if (a.avgRating === null && b.avgRating === null) return 0;
          if (a.avgRating === null) return 1;
          if (b.avgRating === null) return -1;
          return (a.avgRating - b.avgRating) * dir;
        });
        const take = limit ?? 50;
        const skip = page ? (page - 1) * take : 0;
        rated = rated.slice(skip, skip + take);
      }

      // Phase 1 layer 2 + Phase 2 VĐ6: the two fields the buying UI needs. Both are computed
      // for the whole page at once — one grouped slot query and one membership lookup — so
      // the query count does not grow with the number of trainers returned.
      // The viewer comes from the verified token, never from a query parameter — otherwise
      // anyone could ask "rank this list as if I were that user" and read their gym membership.
      const enriched = await enrichForDiscovery(rated, req.user?.id, !sortBy);
      const signed = await Promise.all(
        (enriched as any[]).map((profile) => withSignedProfilePhoto(profile)),
      );

      res.json({ pts: signed });
    } catch (error) {
      logger.error(error, "List PTs error");
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /** One PT's public profile, with their rating and the latest commented reviews. */
  async getPTDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const profile = await profileRepository.findByUserId(userId);
      if (!profile || !(profile as any).isPT) {
        res.status(404).json({ error: "PT not found" });
        return;
      }

      await enrichProfilesWithAuthNames([profile] as any[]);
      const [rating, recentReviews, ratingDistribution] = await Promise.all([
        ptReviewRepository.aggregateForPt(userId),
        ptReviewRepository.recentCommentsForPt(userId, 5),
        ptReviewRepository.ratingDistributionForPt(userId),
      ]);

      res.json({
        ...((await withSignedProfilePhoto(profile as any)) as any),
        ...rating,
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
