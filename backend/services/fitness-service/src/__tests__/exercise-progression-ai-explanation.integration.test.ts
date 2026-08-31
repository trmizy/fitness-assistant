import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// FINAL P0 CLOSURE PASS — docs/TRAINING_PROGRESSION_ARCHITECTURE.md §5.
// Proves the AI-explanation wiring for exercise progression is safe by
// construction, not just "designed to be safe":
//
//   1. AI-down fallback: when ai-service is unreachable, the OPTIONAL
//      explanation endpoint still returns a real, non-empty Vietnamese
//      explanation with zero AI dependency (never throws, never blocks).
//   2. The core deterministic endpoint (getExerciseProgression) is
//      completely unaffected by the explanation endpoint's existence or
//      behavior — same status/nextTarget/reasonCodes before and after,
//      whether or not the explanation call ran.
//   3. DELOAD-conflict: even when a (locally stubbed, in-process) "AI"
//      response explicitly recommends increasing weight, the deterministic
//      status returned by the CORE endpoint stays DELOAD-compatible — this
//      is a structural guarantee (the explanation response schema has no
//      status/nextTarget/decision field at all), verified here empirically
//      by feeding a real HTTP response through the real client code path.
//
// No mocking library is used (none is a project devDependency): a real,
// throwaway http.Server stands in for ai-service for tests 2 and 3, and is
// addressed via AI_SERVICE_URL exactly like the real service would be.

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);

if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type WorkoutServiceLike =
  (typeof import("../services/workout.service"))["workoutService"];
type WorkoutQueueLike =
  (typeof import("../services/workout.service"))["workoutQueue"];

let prisma: PrismaClientLike | undefined;
let workoutService: WorkoutServiceLike | undefined;
let workoutQueue: WorkoutQueueLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/workout.service");
    prisma = prismaModule.prisma;
    workoutService = serviceModule.workoutService;
    workoutQueue = serviceModule.workoutQueue;
  }
  return {
    prisma,
    workoutService: workoutService!,
    workoutQueue: workoutQueue!,
  };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

async function seedExercise(db: PrismaClientLike, id: string, loggingMode = "REPS_LOAD") {
  return db.exercise.create({
    data: {
      id,
      exerciseName: `AI Explanation Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
      loggingMode,
    },
  });
}

async function seedWorkoutWithSets(
  db: PrismaClientLike,
  options: {
    userId: string;
    date: Date;
    exerciseId: string;
    sets: Array<{ weight: number | null; reps: number | null; rir?: number | null }>;
  },
) {
  return db.workout.create({
    data: {
      userId: options.userId,
      name: "AI Explanation Test Workout",
      date: options.date,
      exercises: {
        create: [
          {
            exerciseId: options.exerciseId,
            sets: options.sets.length,
            order: 0,
            workoutSets: {
              create: options.sets.map((s, i) => ({
                setNumber: i + 1,
                weight: s.weight,
                reps: s.reps,
                rir: s.rir ?? null,
                completed: true,
              })),
            },
          },
        ],
      },
    },
  });
}

async function seedActiveCycleWithDecision(
  db: PrismaClientLike,
  userId: string,
  decision: "KEEP" | "PROGRESS" | "ADJUST" | "DELOAD" | "REBUILD" | "INSUFFICIENT_DATA",
) {
  const cycle = await db.trainingCycle.create({
    data: {
      userId,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 31)),
      status: "ACTIVE",
    },
  });
  await db.cycleAssessment.create({
    data: {
      cycleId: cycle.id,
      assessmentVersion: 1,
      status: "COMPLETED",
      decision,
    },
  });
  return cycle;
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.trainingCycle.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-ex-` } } });
}

/** Starts a throwaway HTTP server mimicking ai-service's
 * POST /ai/explain-exercise-progression success envelope, returning a fixed
 * explanation string. Returns { url, close }. */
async function startFakeAiService(explanation: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/ai/explain-exercise-progression") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, data: { explanation, source: "ai" } }));
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "not found" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test(
  "getExerciseProgressionExplanation falls back to a real deterministic explanation when ai-service is unreachable",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `ai-explain-down-it-${Date.now()}`;
    await deleteSeed(db, userId);
    const originalUrl = process.env.AI_SERVICE_URL;
    try {
      // Port 1 is a privileged/unused port nothing listens on in CI/dev —
      // connection refused immediately, simulating ai-service being down.
      process.env.AI_SERVICE_URL = "http://127.0.0.1:1";

      const ex = await seedExercise(db, `${userId}-ex-a`);
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [{ weight: 55, reps: 8, rir: 2 }],
      });
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 8)),
        exerciseId: ex.id,
        sets: [{ weight: 60, reps: 8, rir: 2 }],
      });

      const result = await service.getExerciseProgressionExplanation(userId, ex.id);

      assert.equal(result.source, "deterministic-fallback");
      assert.equal(typeof result.explanation, "string");
      assert.ok(result.explanation.length > 0);
      assert.equal(result.exerciseId, ex.id);
    } finally {
      process.env.AI_SERVICE_URL = originalUrl;
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getExerciseProgression's deterministic status/nextTarget are byte-identical before and after calling the AI-explanation endpoint, and the explanation response has no status/nextTarget/decision field",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `ai-explain-noninterference-it-${Date.now()}`;
    await deleteSeed(db, userId);
    const originalUrl = process.env.AI_SERVICE_URL;
    const fakeAi = await startFakeAiService(
      "Bạn nên tăng tải nặng hơn nhiều so với đề xuất, vì đây chỉ là văn bản của AI, không phải quyết định.",
    );
    try {
      process.env.AI_SERVICE_URL = fakeAi.url;

      const ex = await seedExercise(db, `${userId}-ex-a`);
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [{ weight: 55, reps: 8, rir: 2 }],
      });
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 8)),
        exerciseId: ex.id,
        sets: [{ weight: 60, reps: 8, rir: 2 }],
      });

      const before = await service.getExerciseProgression(userId, ex.id);
      assert.equal(before.status, "INCREASE_LOAD");

      const explanation = await service.getExerciseProgressionExplanation(userId, ex.id);
      assert.equal(explanation.source, "ai");
      // Structural guarantee: this response literally cannot carry a
      // decision/target field for anything to accidentally read downstream.
      assert.deepEqual(Object.keys(explanation).sort(), ["exerciseId", "explanation", "source"]);

      const after = await service.getExerciseProgression(userId, ex.id);
      assert.deepEqual(after, before);
    } finally {
      process.env.AI_SERVICE_URL = originalUrl;
      await fakeAi.close();
      await deleteSeed(db, userId);
    }
  },
);

test(
  "DELOAD-conflict: even when the (stubbed) AI text recommends increasing weight, the deterministic core endpoint's status stays DELOAD-compatible, never INCREASE_LOAD",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `ai-explain-deload-conflict-it-${Date.now()}`;
    await deleteSeed(db, userId);
    const originalUrl = process.env.AI_SERVICE_URL;
    const fakeAi = await startFakeAiService(
      "Bạn đã tập rất tốt, hãy tăng tải lên ở buổi sau!",
    );
    try {
      process.env.AI_SERVICE_URL = fakeAi.url;

      // History that, on its own (no active cycle), would produce
      // INCREASE_LOAD — see the sibling non-AI DELOAD precedence test.
      const ex = await seedExercise(db, `${userId}-ex-a`);
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [{ weight: 55, reps: 8, rir: 2 }],
      });
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 8)),
        exerciseId: ex.id,
        sets: [{ weight: 60, reps: 8, rir: 2 }],
      });
      await seedActiveCycleWithDecision(db, userId, "DELOAD");

      // Call the AI-backed explanation endpoint FIRST — proves the AI text
      // recommending an increase cannot leak into the deterministic result
      // that's computed afterward (or before; order is irrelevant since
      // there is no shared mutable state between the two call paths).
      const explanation = await service.getExerciseProgressionExplanation(userId, ex.id);
      assert.equal(explanation.source, "ai");

      const progression = await service.getExerciseProgression(userId, ex.id);
      assert.equal(progression.cycleContext, "DELOAD");
      assert.notEqual(progression.status, "INCREASE_LOAD");
      assert.ok(
        progression.reasonCodes.includes("CYCLE_DELOAD_OVERRIDES_LOCAL_SIGNAL"),
        `expected DELOAD precedence reason code, got: ${JSON.stringify(progression.reasonCodes)}`,
      );
    } finally {
      process.env.AI_SERVICE_URL = originalUrl;
      await fakeAi.close();
      await deleteSeed(db, userId);
    }
  },
);
