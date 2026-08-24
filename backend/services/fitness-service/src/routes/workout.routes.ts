import { Router } from "express";
import {
  authMiddleware,
  internalAuthMiddleware,
} from "../middleware/auth.middleware";
import { workoutController } from "../controllers/workout.controller";

const router = Router();

// NOTE: named routes must be declared BEFORE /:id to avoid route shadowing
router.post(
  "/generate",
  authMiddleware,
  workoutController.generateWorkout as any,
);
router.post(
  "/from-ai-plan",
  internalAuthMiddleware,
  workoutController.importAiPlan as any,
);
router.get("/prs", authMiddleware, workoutController.getPRs as any);
// "Previous performance" prefill — see workout.service.ts getPreviousPerformance.
// Named route, must stay before /:id (see note above).
router.get(
  "/exercises/:exerciseId/previous-performance",
  authMiddleware,
  workoutController.getPreviousPerformance as any,
);
// Deterministic per-exercise progression (docs/TRAINING_PROGRESSION_ARCHITECTURE.md).
// Named route, must stay before /:id (see note above).
router.get(
  "/exercises/:exerciseId/progression",
  authMiddleware,
  workoutController.getExerciseProgression as any,
);
// openGym FINAL P0 CLOSURE PASS — OPTIONAL AI-explanation sibling of the
// deterministic /progression route above. Separate endpoint (not a query
// param on /progression) so the fast, always-available, purely-deterministic
// route is structurally never coupled to ai-service being reachable.
// Named route, must stay before /:id (see note above).
router.get(
  "/exercises/:exerciseId/progression/explanation",
  authMiddleware,
  workoutController.getExerciseProgressionExplanation as any,
);
router.get(
  "/schedules",
  authMiddleware,
  workoutController.listSchedules as any,
);
router.post(
  "/schedules",
  authMiddleware,
  workoutController.createSchedule as any,
);
router.post(
  "/schedules/:id/start",
  authMiddleware,
  workoutController.startSchedule as any,
);
router.post(
  "/schedules/:id/exercises/:programExerciseId/complete",
  authMiddleware,
  workoutController.completeScheduleExercise as any,
);
// Roadmap P1.6 "undo last set" — sibling of /complete above.
router.post(
  "/schedules/:id/exercises/:programExerciseId/undo-complete",
  authMiddleware,
  workoutController.undoCompleteScheduleExercise as any,
);
router.delete(
  "/schedules/:id",
  authMiddleware,
  workoutController.deleteSchedule as any,
);
router.post(
  "/schedules/:id/skip",
  authMiddleware,
  workoutController.skipSchedule as any,
);
router.post(
  "/schedules/:id/cancel",
  authMiddleware,
  workoutController.cancelSchedule as any,
);

// Phase 2 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md
router.get(
  "/schedules/:id/feedback",
  authMiddleware,
  workoutController.getSessionFeedback as any,
);
router.post(
  "/schedules/:id/feedback",
  authMiddleware,
  workoutController.submitSessionFeedback as any,
);
router.patch(
  "/schedules/:id/feedback",
  authMiddleware,
  workoutController.updateSessionFeedback as any,
);
router.post(
  "/schedules/:id/feedback/dismiss",
  authMiddleware,
  workoutController.dismissSessionFeedback as any,
);

router.get(
  "/programs/current",
  authMiddleware,
  workoutController.getCurrentProgram as any,
);
router.post(
  "/programs/manual",
  authMiddleware,
  workoutController.createManualProgram as any,
);
router.patch(
  "/programs/:id",
  authMiddleware,
  workoutController.updateProgram as any,
);
router.delete(
  "/programs/:id",
  authMiddleware,
  workoutController.deleteProgram as any,
);

router.patch(
  "/program-days/:id",
  authMiddleware,
  workoutController.updateProgramDay as any,
);
router.post(
  "/program-days/:id/exercises",
  authMiddleware,
  workoutController.addProgramExercise as any,
);

router.patch(
  "/program-exercises/:id",
  authMiddleware,
  workoutController.updateProgramExercise as any,
);
router.delete(
  "/program-exercises/:id",
  authMiddleware,
  workoutController.deleteProgramExercise as any,
);

router.patch(
  "/sets/:setId",
  authMiddleware,
  workoutController.updateSet as any,
);
router.get("/", authMiddleware, workoutController.listWorkouts as any);
router.get("/:id", authMiddleware, workoutController.getWorkout as any);
router.post("/", authMiddleware, workoutController.createWorkout as any);
router.put("/:id", authMiddleware, workoutController.updateWorkout as any);
router.delete("/:id", authMiddleware, workoutController.deleteWorkout as any);
// Append a single set to an existing workout (BUG-007 / BR-WK-02).
router.post("/:id/sets", authMiddleware, workoutController.addSet as any);
// End-of-session PR/volume summary — see workout.service.ts getSessionSummary.
router.get(
  "/:id/summary",
  authMiddleware,
  workoutController.getSessionSummary as any,
);

export default router;
