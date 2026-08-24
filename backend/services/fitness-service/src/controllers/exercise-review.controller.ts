import { Response } from "express";
import { logger } from "@gym-coach/shared";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  listReviewCandidates,
  getReviewCandidateDetail,
  getReviewHistory,
  submitReviewDecision,
  type ReviewDecisionKind,
} from "../services/exercise-review.service";
import type { DuplicateDecision } from "../services/exercise-duplicate-detector";

// Gate 7 — every route here is admin-only. Never automates a decision;
// every mutating action requires an authenticated admin explicitly
// choosing it through submitReviewDecision.
function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Admin role required" });
    return false;
  }
  return true;
}

export const exerciseReviewController = {
  // Lightweight counts-only view (pending/decision-tier breakdown) for a
  // dashboard header — reuses the same computation as listCandidates but
  // returns only the summary, not every candidate row.
  async getSummary(req: AuthRequest, res: Response): Promise<void> {
    if (!requireAdmin(req, res)) return;
    try {
      const { summary } = await listReviewCandidates({ status: "ALL" });
      res.json({ summary });
    } catch (error: any) {
      logger.error({ err: error }, "Error loading Gate 7 review summary");
      res.status(500).json({ error: "Failed to load review summary" });
    }
  },

  async listCandidates(req: AuthRequest, res: Response): Promise<void> {
    if (!requireAdmin(req, res)) return;
    try {
      const { status, decisionTier, search } = req.query as Record<string, string>;
      const result = await listReviewCandidates({
        status: status === "PENDING" || status === "REVIEWED" || status === "ALL" ? status : "PENDING",
        decisionTier: decisionTier as DuplicateDecision | undefined,
        search,
      });
      res.json(result);
    } catch (error: any) {
      logger.error({ err: error }, "Error listing Gate 7 review candidates");
      res.status(500).json({ error: "Failed to load review candidates" });
    }
  },

  async getCandidateDetail(req: AuthRequest, res: Response): Promise<void> {
    if (!requireAdmin(req, res)) return;
    try {
      const detail = await getReviewCandidateDetail(req.params.externalRef);
      if (!detail) {
        res.status(404).json({ error: "Candidate not found or already resolved" });
        return;
      }
      res.json(detail);
    } catch (error: any) {
      logger.error({ err: error }, "Error fetching Gate 7 candidate detail");
      res.status(500).json({ error: "Failed to load candidate detail" });
    }
  },

  async getHistory(req: AuthRequest, res: Response): Promise<void> {
    if (!requireAdmin(req, res)) return;
    try {
      const history = await getReviewHistory(req.params.externalRef);
      res.json({ externalRef: req.params.externalRef, history });
    } catch (error: any) {
      logger.error({ err: error }, "Error fetching Gate 7 review history");
      res.status(500).json({ error: "Failed to load review history" });
    }
  },

  async submitDecision(req: AuthRequest, res: Response): Promise<void> {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body || {};
      const result = await submitReviewDecision({
        externalRef: req.params.externalRef,
        decision: body.decision as ReviewDecisionKind,
        targetExerciseId: body.targetExerciseId,
        note: body.note,
        reviewerId: req.user!.id,
      });
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error submitting Gate 7 review decision");
      res.status(500).json({ error: "Failed to submit review decision" });
    }
  },
};
