import { Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { workoutService } from "../services/workout.service";
import { sessionFeedbackService } from "../services/session-feedback.service";
import {
  completeScheduleExerciseSchema,
  createManualProgramSchema,
  createWorkoutSchema,
  importAiPlanSchema,
  updateWorkoutSetSchema,
} from "../models/fitness.models";
import { sessionFeedbackInputSchema, dismissFeedbackSchema } from "../models/session-feedback.models";
import { formatZodErrors } from "../utils/workout-validation";
import type { AuthRequest } from "../middleware/auth.middleware";

export const workoutController = {
  async listWorkouts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { startDate, endDate, limit } = req.query as Record<string, string>;
      const workouts = await workoutService.listWorkouts(req.user!.id, {
        startDate,
        endDate,
        limit,
      });
      res.json(workouts);
    } catch (error) {
      logger.error({ err: error }, "Error fetching workouts");
      res.status(500).json({ error: "Failed to fetch workouts" });
    }
  },

  async getWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const workout = await workoutService.getWorkout(
        req.params.id,
        req.user!.id,
      );
      res.json(workout);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error fetching workout:", error);
      res.status(500).json({ error: "Failed to fetch workout" });
    }
  },

  async createWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createWorkoutSchema.parse(req.body);
      const workout = await workoutService.createWorkout(req.user!.id, data);
      res.status(201).json(workout);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error(
          { validationErrors: error.errors },
          "Workout validation failed",
        );
        res.status(400).json({
          error: "Invalid workout data",
          details: formatZodErrors(error.errors),
        });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error creating workout:", error);
      res.status(500).json({ error: "Failed to create workout" });
    }
  },

  async updateWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createWorkoutSchema.parse(req.body);
      const workout = await workoutService.updateWorkout(
        req.params.id,
        req.user!.id,
        data,
      );
      res.json(workout);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error(
          { validationErrors: error.errors },
          "Workout update validation failed",
        );
        res.status(400).json({
          error: "Invalid workout data",
          details: formatZodErrors(error.errors),
        });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error updating workout:", error);
      res.status(500).json({ error: "Failed to update workout" });
    }
  },

  async deleteWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.deleteWorkout(
        req.params.id,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error deleting workout:", error);
      res.status(500).json({ error: "Failed to delete workout" });
    }
  },

  async getPRs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { exerciseId } = req.query as Record<string, string>;
      const prs = await workoutService.getPRs(req.user!.id, exerciseId);
      res.json(prs);
    } catch (error) {
      logger.error("Error fetching PRs:", error);
      res.status(500).json({ error: "Failed to fetch PRs" });
    }
  },

  async getSessionSummary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const summary = await workoutService.getSessionSummary(
        req.user!.id,
        req.params.id,
      );
      res.json(summary);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error fetching session summary:", error);
      res.status(500).json({ error: "Failed to fetch session summary" });
    }
  },

  async updateSet(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = updateWorkoutSetSchema.parse(req.body);
      const result = await workoutService.updateSet(
        req.params.setId,
        req.user!.id,
        data,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Validation failed", details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error updating set:", error);
      res.status(500).json({ error: "Failed to update set" });
    }
  },

  async generateWorkout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { goal, duration, equipment, bodyParts } = req.body;
      const result = await workoutService.queueWorkoutGeneration(req.user!.id, {
        goal,
        duration,
        equipment,
        bodyParts,
      });
      res.status(202).json(result);
    } catch (error) {
      logger.error("Error queuing workout generation:", error);
      res.status(500).json({ error: "Failed to start workout generation" });
    }
  },

  // POST /workouts/:id/sets — append a single set to a workout's exercise.
  async listSchedules(req: AuthRequest, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const { startDate, endDate } = req.query as Record<
        string,
        string | undefined
      >;
      const schedules = await workoutService.listSchedules(req.user!.id, {
        limit,
        startDate,
        endDate,
      });
      res.json(schedules);
    } catch (error) {
      logger.error({ err: error }, "Error fetching workout schedules");
      res.status(500).json({ error: "Failed to fetch workout schedules" });
    }
  },

  async createSchedule(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.createSchedule(
        req.user!.id,
        req.body || {},
      );
      res
        .status(result.alreadyExists ? 200 : 201)
        .json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error creating workout schedule");
      res.status(500).json({ error: "Failed to create workout schedule" });
    }
  },

  async startSchedule(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.startSchedule(
        req.user!.id,
        req.params.id,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error starting workout schedule");
      res.status(500).json({ error: "Failed to start workout schedule" });
    }
  },

  async completeScheduleExercise(
    req: AuthRequest,
    res: Response,
  ): Promise<void> {
    try {
      // Body is entirely optional (backward compatible with the old no-body
      // shape) — see completeScheduleExerciseSchema's comment for why this
      // exists: it's the only way the actually-performed weight/reps/RPE/RIR
      // and a session-only exercise swap ever reach the persisted log.
      const body = completeScheduleExerciseSchema.parse(req.body ?? {});
      const result = await workoutService.completeScheduleExercise(
        req.user!.id,
        req.params.id,
        req.params.programExerciseId,
        body,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid exercise completion data",
          details: formatZodErrors(error.errors),
        });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(
        { err: error },
        "Error completing workout schedule exercise",
      );
      res.status(500).json({ error: "Failed to complete workout exercise" });
    }
  },

  async createManualProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = createManualProgramSchema.parse(req.body);
      const result = await workoutService.createManualProgram(
        req.user!.id,
        data,
      );
      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid manual program data",
          details: formatZodErrors(error.errors),
        });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error creating manual workout program");
      res
        .status(500)
        .json({ error: "Failed to create manual workout program" });
    }
  },

  async importAiPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = importAiPlanSchema.parse(req.body);
      const result = await workoutService.importAiPlanToSchedule(
        req.user!.id,
        data,
      );
      res
        .status(result.alreadyExists ? 200 : 201)
        .json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid AI plan data",
          details: formatZodErrors(error.errors),
        });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error importing AI plan");
      res.status(500).json({ error: "Failed to import AI plan" });
    }
  },

  async addSet(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.addSet(
        req.params.id,
        req.user!.id,
        req.body,
      );
      res.status(201).json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error adding set:", error);
      res.status(500).json({ error: "Failed to add set" });
    }
  },

  async getCurrentProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const program = await workoutService.getCurrentProgram(req.user!.id);
      res.json({ success: true, data: { program: program || null } });
    } catch (error) {
      logger.error({ err: error }, "Error fetching current program");
      res.status(500).json({ error: "Failed to fetch current program" });
    }
  },

  async updateProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const program = await workoutService.updateProgram(
        req.params.id,
        req.user!.id,
        req.body,
      );
      res.json(program);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error updating program");
      res.status(500).json({ error: "Failed to update program" });
    }
  },

  async deleteProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.deleteProgram(
        req.params.id,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deleting program");
      res.status(500).json({ error: "Failed to delete program" });
    }
  },

  async updateProgramDay(req: AuthRequest, res: Response): Promise<void> {
    try {
      const day = await workoutService.updateProgramDay(
        req.params.id,
        req.user!.id,
        req.body,
      );
      res.json(day);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error updating program day");
      res.status(500).json({ error: "Failed to update program day" });
    }
  },

  async addProgramExercise(req: AuthRequest, res: Response): Promise<void> {
    try {
      const exercise = await workoutService.addProgramExercise(
        req.params.id,
        req.user!.id,
        req.body,
      );
      res.status(201).json(exercise);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error adding program exercise");
      res.status(500).json({ error: "Failed to add program exercise" });
    }
  },

  async updateProgramExercise(req: AuthRequest, res: Response): Promise<void> {
    try {
      const exercise = await workoutService.updateProgramExercise(
        req.params.id,
        req.user!.id,
        req.body,
      );
      res.json(exercise);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error updating program exercise");
      res.status(500).json({ error: "Failed to update program exercise" });
    }
  },

  async deleteProgramExercise(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.deleteProgramExercise(
        req.params.id,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deleting program exercise");
      res.status(500).json({ error: "Failed to delete program exercise" });
    }
  },

  async deleteSchedule(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await workoutService.deleteSchedule(
        req.params.id,
        req.user!.id,
      );
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error deleting schedule");
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  },

  async skipSchedule(req: AuthRequest, res: Response): Promise<void> {
    try {
      const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;
      const result = await workoutService.skipSchedule(req.params.id, req.user!.id, notes);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error skipping schedule");
      res.status(500).json({ error: "Failed to skip schedule" });
    }
  },

  async cancelSchedule(req: AuthRequest, res: Response): Promise<void> {
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) {
        res.status(400).json({ error: "A cancellation reason is required" });
        return;
      }
      const result = await workoutService.cancelSchedule(req.params.id, req.user!.id, reason);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error cancelling schedule");
      res.status(500).json({ error: "Failed to cancel schedule" });
    }
  },

  // Phase 2 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — session
  // feedback addressable directly by schedule id (works for sessions
  // outside a training cycle too, unlike the older cycle-nested endpoint).
  async getSessionFeedback(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await sessionFeedbackService.getFeedback(req.params.id, req.user!.id);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error fetching session feedback");
      res.status(500).json({ error: "Failed to fetch session feedback" });
    }
  },

  async submitSessionFeedback(req: AuthRequest, res: Response): Promise<void> {
    try {
      const parsed = sessionFeedbackInputSchema.parse(req.body ?? {});
      const result = await sessionFeedbackService.upsertFeedback(req.params.id, req.user!.id, parsed);
      res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid feedback payload" });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error submitting session feedback");
      res.status(500).json({ error: "Failed to submit session feedback" });
    }
  },

  async updateSessionFeedback(req: AuthRequest, res: Response): Promise<void> {
    try {
      const parsed = sessionFeedbackInputSchema.parse(req.body ?? {});
      const result = await sessionFeedbackService.upsertFeedback(req.params.id, req.user!.id, parsed);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid feedback payload" });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error updating session feedback");
      res.status(500).json({ error: "Failed to update session feedback" });
    }
  },

  async dismissSessionFeedback(req: AuthRequest, res: Response): Promise<void> {
    try {
      dismissFeedbackSchema.parse(req.body ?? {});
      const result = await sessionFeedbackService.dismissFeedback(req.params.id, req.user!.id);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors[0]?.message ?? "Invalid request" });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error dismissing session feedback");
      res.status(500).json({ error: "Failed to dismiss session feedback" });
    }
  },
};
