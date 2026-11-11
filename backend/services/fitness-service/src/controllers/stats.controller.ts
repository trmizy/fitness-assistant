import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { statsService } from "../services/stats.service";
import { getBodyGoalState, normalizeBodyLookbackDays } from "../services/body-goal-state.service";
import {
  getTrainingAnalyticsWindow,
  normalizeWindowDays,
} from "../services/training-analytics-window.service";
import type { AuthRequest } from "../middleware/auth.middleware";

export const statsController = {
  // Phase 4.4 — observed body state + goal gap/trajectory. Read-only; identity from the authenticated request only.
  async getBodyGoalState(req: AuthRequest, res: Response): Promise<void> {
    let lookbackDays: number;
    try {
      const raw = req.query.lookbackDays;
      lookbackDays = normalizeBodyLookbackDays(raw === undefined ? undefined : Number(raw));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    try {
      res.json(await getBodyGoalState(req.user!.id, { lookbackDays }));
    } catch (error) {
      // An upstream (user-service) failure is reported as such — never as an empty body state.
      logger.error("Error fetching body/goal state:", error);
      res.status(502).json({ error: "Failed to read body/goal state" });
    }
  },

  // Phase 4.1 — rolling-window training analytics. Read-only; identity comes
  // from the authenticated request only (no userId parameter exists).
  async getTrainingWindow(req: AuthRequest, res: Response): Promise<void> {
    let days: number;
    try {
      const raw = req.query.days;
      days = normalizeWindowDays(raw === undefined ? undefined : Number(raw));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    try {
      res.json(await getTrainingAnalyticsWindow(req.user!.id, { days }));
    } catch (error) {
      logger.error("Error fetching training analytics window:", error);
      res.status(500).json({ error: "Failed to fetch training analytics" });
    }
  },

  async getWorkoutStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = parseInt((req.query.days as string) || "30");
      const stats = await statsService.getWorkoutStats(req.user!.id, days);
      res.json(stats);
    } catch (error) {
      logger.error("Error fetching workout stats:", error);
      res.status(500).json({ error: "Failed to fetch workout stats" });
    }
  },

  async getNutritionStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const days = parseInt((req.query.days as string) || "7");
      const stats = await statsService.getNutritionStats(req.user!.id, days);
      res.json(stats);
    } catch (error) {
      logger.error("Error fetching nutrition stats:", error);
      res.status(500).json({ error: "Failed to fetch nutrition stats" });
    }
  },

  // Roadmap P3.1 "Muscle heatmap" (docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md).
  async getMuscleHeatmap(req: AuthRequest, res: Response): Promise<void> {
    try {
      const range = (req.query.range as string) || "30d";
      if (!["7d", "30d", "cycle", "custom"].includes(range)) {
        res.status(400).json({ error: "range must be one of: 7d, 30d, cycle, custom" });
        return;
      }
      const heatmap = await statsService.getMuscleHeatmap(req.user!.id, {
        range: range as "7d" | "30d" | "cycle" | "custom",
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      res.json(heatmap);
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error fetching muscle heatmap:", error);
      res.status(500).json({ error: "Failed to fetch muscle heatmap" });
    }
  },

  // Roadmap P3.2 "Activity heatmap" (docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md).
  async getActivityHeatmap(req: AuthRequest, res: Response): Promise<void> {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
        return;
      }
      const heatmap = await statsService.getActivityHeatmap(req.user!.id, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`));
      res.json(heatmap);
    } catch (error: any) {
      logger.error("Error fetching activity heatmap:", error);
      res.status(500).json({ error: "Failed to fetch activity heatmap" });
    }
  },

  async getActivityDayDetail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const detail = await statsService.getActivityDayDetail(req.user!.id, req.params.date);
      res.json(detail);
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error fetching activity day detail:", error);
      res.status(500).json({ error: "Failed to fetch activity day detail" });
    }
  },

  // Roadmap P3.3 "Exercise progress charts" (docs/features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md).
  async getExerciseProgress(req: AuthRequest, res: Response): Promise<void> {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if ((from && !to) || (!from && to)) {
        res.status(400).json({ error: "from and to must both be provided together (YYYY-MM-DD)" });
        return;
      }
      if (from && to && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
        res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
        return;
      }
      const progress = await statsService.getExerciseProgress(req.user!.id, req.params.exerciseId, { from, to });
      res.json(progress);
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error fetching exercise progress:", error);
      res.status(500).json({ error: "Failed to fetch exercise progress" });
    }
  },
};
