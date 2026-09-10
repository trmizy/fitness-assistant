import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  acceptAiRoadmapDraftSchema,
  activatePhaseSchema,
  activateRoadmapSchema,
  addRoadmapPhaseSchema,
  applyRoadmapRebuildSchema,
  createFitnessRoadmapSchema,
  fitnessDiagnosisInputSchema,
  generateAiRoadmapDraftSchema,
  roadmapPhaseForecastInputSchema,
} from "../models/fitness-roadmap.models";
import { fitnessRoadmapService } from "../services/fitness-roadmap.service";

function handleServiceError(res: Response, error: any, fallbackMessage: string): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.errors[0]?.message ?? "Invalid request body" });
    return;
  }
  if (error.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error({ err: error }, fallbackMessage);
  res.status(500).json({ error: fallbackMessage });
}

export const fitnessRoadmapController = {
  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = createFitnessRoadmapSchema.parse(req.body ?? {});
      const roadmap = await fitnessRoadmapService.createDraftRoadmap(req.user!.id, body);
      res.status(201).json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to create fitness roadmap");
    }
  },

  async generateAiDraft(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = generateAiRoadmapDraftSchema.parse(req.body ?? {});
      const draft = await fitnessRoadmapService.generateAiRoadmapDraft(req.user!.id, body);
      res.json(draft);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to generate AI roadmap draft");
    }
  },

  // Gymini Guided Roadmap Creation — read-only, no persistence. Body is
  // POST (not GET) purely because the wizard sends a non-trivial payload
  // of unsaved overrides; the semantics stay a pure read.
  async diagnosis(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = fitnessDiagnosisInputSchema.parse(req.body ?? {});
      const diagnosis = await fitnessRoadmapService.getDiagnosis(req.user!.id, body);
      res.json(diagnosis);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to compute fitness diagnosis");
    }
  },

  // Gymini Roadmap Projection & Strategy Report Hardening — read-only,
  // no persistence. See docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md §13.
  async projection(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = roadmapPhaseForecastInputSchema.parse(req.body ?? {});
      const forecast = await fitnessRoadmapService.getPhaseForecast(req.user!.id, body);
      res.json(forecast);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to compute roadmap phase projection");
    }
  },

  // Gymini Adaptive Forecast Reconciliation — read-only. See
  // docs/GYMINI_ADAPTIVE_FORECAST_RECONCILIATION_DESIGN.md §15.
  async currentForecast(req: AuthRequest, res: Response): Promise<void> {
    try {
      const forecast = await fitnessRoadmapService.getCurrentForecast(req.user!.id);
      res.json(forecast);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch current roadmap forecast");
    }
  },

  async acceptAiDraft(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = acceptAiRoadmapDraftSchema.parse(req.body ?? {});
      const roadmap = await fitnessRoadmapService.acceptAiRoadmapDraft(req.user!.id, body);
      res.status(201).json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to accept AI roadmap draft");
    }
  },

  async current(req: AuthRequest, res: Response): Promise<void> {
    try {
      const roadmap = await fitnessRoadmapService.getCurrentRoadmap(req.user!.id);
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch current fitness roadmap");
    }
  },

  // Self-service DRAFT lookup — surfaces a PT-created (or the user's own
  // not-yet-activated) draft, which GET /current (ACTIVE-only, unchanged)
  // cannot. See fitnessRoadmapService.getCurrentDraftRoadmap.
  async currentDraft(req: AuthRequest, res: Response): Promise<void> {
    try {
      const roadmap = await fitnessRoadmapService.getCurrentDraftRoadmap(req.user!.id);
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch current draft fitness roadmap");
    }
  },

  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const roadmap = await fitnessRoadmapService.getRoadmapById(req.user!.id, req.params.roadmapId);
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to fetch fitness roadmap");
    }
  },

  async addPhase(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = addRoadmapPhaseSchema.parse(req.body ?? {});
      const phase = await fitnessRoadmapService.addPlannedPhase(req.user!.id, req.params.roadmapId, body);
      res.status(201).json(phase);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to add roadmap phase");
    }
  },

  async activate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = activateRoadmapSchema.parse(req.body ?? {});
      const roadmap = await fitnessRoadmapService.activateRoadmap(req.user!.id, req.params.roadmapId, body);
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to activate fitness roadmap");
    }
  },

  async activatePhase(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = activatePhaseSchema.parse(req.body ?? {});
      const roadmap = await fitnessRoadmapService.activatePhase(
        req.user!.id,
        req.params.roadmapId,
        req.params.phaseId,
        body,
      );
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to activate roadmap phase");
    }
  },

  async advance(req: AuthRequest, res: Response): Promise<void> {
    try {
      const roadmap = await fitnessRoadmapService.advanceRoadmap(req.user!.id, req.params.roadmapId);
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to advance fitness roadmap");
    }
  },

  async previewRebuild(req: AuthRequest, res: Response): Promise<void> {
    try {
      const proposal = await fitnessRoadmapService.prepareRoadmapRebuild(req.user!.id, req.params.roadmapId);
      res.json(proposal);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to preview roadmap rebuild");
    }
  },

  async applyRebuild(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = applyRoadmapRebuildSchema.parse(req.body ?? {});
      const roadmap = await fitnessRoadmapService.applyRoadmapRebuild(req.user!.id, req.params.roadmapId, body);
      res.json(roadmap);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to apply roadmap rebuild");
    }
  },

  async archive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await fitnessRoadmapService.archiveRoadmap(req.user!.id, req.params.roadmapId);
      res.json(result);
    } catch (error: any) {
      handleServiceError(res, error, "Failed to archive fitness roadmap");
    }
  },
};
