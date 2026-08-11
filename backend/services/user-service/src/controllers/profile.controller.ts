import { Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import {
  profileService,
  enrichProfilesWithAuthNames,
} from "../services/profile.service";
import { profileRepository, prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import {
  ptReviewRepository,
  attachPtRatings,
} from "../repositories/ptReview.repository";
import { adminPTStatusSchema, profileSchema } from "../models/profile.models";
import type { AuthRequest } from "../middleware/auth.middleware";

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

      res.json({ pts: rated });
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
      const [rating, recentReviews] = await Promise.all([
        ptReviewRepository.aggregateForPt(userId),
        ptReviewRepository.recentCommentsForPt(userId, 5),
      ]);

      res.json({ ...(profile as any), ...rating, recentReviews });
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
      res.json({ profile });
    } catch (error) {
      logger.error(error, "Toggle accepting clients error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
};
