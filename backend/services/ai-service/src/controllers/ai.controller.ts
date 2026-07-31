import { Request, Response, NextFunction } from "express";
import {
  logger,
  aiCoachQueriesTotal,
  aiCoachQueryDuration,
} from "@gym-coach/shared";
import { ragService } from "../services/rag.service";
import { conversationService } from "../services/conversation.service";
import {
  ApiError,
  LlmError,
  LlmGenerationError,
  formatSuccessResponse,
  formatErrorResponse,
} from "../errors/api-error";
import type {
  AskRequest,
  FeedbackRequest,
  GenerateWorkoutRequest,
} from "../schemas/ai.schemas";

export const aiController = {
  async ask(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    // userId is guaranteed by requireAuth middleware
    const { userId, authorizationHeader } = req.context;
    const { question, sessionId } = req.body as AskRequest;

    try {
      const result = await ragService.rag(
        question,
        userId,
        authorizationHeader,
        sessionId,
      );

      aiCoachQueriesTotal.inc({ status: "success" });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      res.json(formatSuccessResponse(result));
    } catch (err) {
      aiCoachQueriesTotal.inc({ status: "failure" });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      if (err instanceof LlmError) {
        // Return structured 503 — do NOT leak infra details to the client.
        res
          .status(503)
          .json(
            formatErrorResponse(
              "LLM_UNAVAILABLE",
              "AI service is temporarily unavailable. Please try again shortly.",
            ),
          );
        return;
      }
      logger.error({ err, userId }, "Error in /ai/ask");
      next(err);
    }
  },

  async askStream(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    const startTime = Date.now();
    const { userId, authorizationHeader } = req.context;
    const { question, sessionId } = req.body as AskRequest;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Use res.on('close') — NOT req.on('close'). The req close event fires almost
    // immediately when the HTTP client half-closes its write side after sending the
    // request body (normal TCP behaviour), which does NOT mean the browser disconnected.
    // res.close fires only when the response connection is truly gone.
    let clientDisconnected = false;
    res.on("close", () => {
      clientDisconnected = true;
    });

    const sendEvent = (
      type: string,
      payload?: Record<string, unknown>,
    ): void => {
      if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      }
    };

    try {
      const result = await ragService.rag(
        question,
        userId,
        authorizationHeader,
        sessionId,
        (message) => sendEvent("status", { message }),
      );

      aiCoachQueriesTotal.inc({ status: "success" });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      // Stream the answer in small chunks to create a typing effect in the browser.
      // This is intentional UX pacing — the LLM returns the full answer at once, so
      // chunking with a short interval prevents React from receiving everything in
      // one batch and rendering the final text without animation.
      const answer = result.answer;
      const CHUNK_SIZE = 4;
      const TOKEN_INTERVAL_MS = 18;
      const tokenTick = (ms: number): Promise<void> =>
        new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < answer.length; i += CHUNK_SIZE) {
        if (clientDisconnected) break;
        sendEvent("token", { content: answer.slice(i, i + CHUNK_SIZE) });
        await tokenTick(TOKEN_INTERVAL_MS);
      }

      sendEvent("done", {
        conversationId: result.conversationId,
        sessionId: result.sessionId,
        evidenceUsed: result.evidenceUsed ?? [],
        adjustmentReasons: result.adjustmentReasons ?? [],
        safetyNotes: result.safetyNotes ?? [],
        timing: result.timing,
        fallbackReason: result.fallbackReason,
      });
    } catch (err) {
      aiCoachQueriesTotal.inc({ status: "failure" });
      aiCoachQueryDuration.observe((Date.now() - startTime) / 1000);

      // Must check SESSION_NOT_FOUND before the LlmError check below —
      // LlmError extends ApiError, so a generic ApiError check would need to
      // come after it, not before, to avoid misclassifying LLM failures.
      if (err instanceof ApiError && err.code === "SESSION_NOT_FOUND") {
        sendEvent("error", { message: err.message });
      } else if (err instanceof LlmError) {
        sendEvent("error", {
          message:
            "AI service is temporarily unavailable. Please try again shortly.",
        });
      } else {
        logger.error({ err, userId }, "Error in /ai/ask/stream");
        sendEvent("error", {
          message: "An unexpected error occurred. Please try again.",
        });
      }
    } finally {
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  },

  async getConversations(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { userId } = req.context;
    // limit is already parsed and validated by validateQuery middleware
    const limit = Number(req.query["limit"]) || 10;

    try {
      const result = await conversationService.getConversations(userId, limit);
      res.json(formatSuccessResponse(result));
    } catch (err) {
      logger.error({ err, userId }, "Error fetching conversations");
      next(err);
    }
  },

  async submitFeedback(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { conversationId, feedback } = req.body as FeedbackRequest;

    try {
      const result = await conversationService.submitFeedback(
        conversationId,
        feedback,
      );
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Error saving feedback");
      next(err);
    }
  },

  async getFeedbackStats(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const stats = await conversationService.getFeedbackStats();
      res.json(formatSuccessResponse(stats));
    } catch (err) {
      logger.error({ err }, "Error fetching feedback stats");
      next(err);
    }
  },

  async generateWorkout(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const params = req.body as GenerateWorkoutRequest;

    try {
      const result = await conversationService.generateWorkout(params);
      res.json(formatSuccessResponse(result));
    } catch (err) {
      if (err instanceof LlmError) {
        res
          .status(503)
          .json(
            formatErrorResponse(
              "LLM_UNAVAILABLE",
              "AI service is temporarily unavailable. Please try again shortly.",
            ),
          );
        return;
      }
      if (err instanceof LlmGenerationError) {
        res
          .status(502)
          .json(
            formatErrorResponse(
              "LLM_GENERATION_FAILED",
              "AI returned invalid structured output. Please retry.",
            ),
          );
        return;
      }
      logger.error({ err }, "Error generating workout");
      next(err);
    }
  },
};
