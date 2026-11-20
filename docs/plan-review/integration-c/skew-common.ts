// Shared fixtures for the API/worker version-skew experiments (fake fitness-service over HTTP + a plan-JSON-producing model stub). No provider is contacted.
import http from "node:http";
import type { AddressInfo } from "node:net";
export const CATALOG = Array.from({ length: 60 }, (_, i) => ({
  id: `cat-${String(i + 1).padStart(2, "0")}`, exerciseName: `Catalog Exercise ${i + 1}`, bodyPart: "FULL_BODY", typeOfActivity: "STRENGTH", typeOfEquipment: "DUMBBELL",
  muscleGroupsActivated: ["chest", "back", "legs"], movementPattern: "PUSH", mechanics: "COMPOUND", difficultyLevel: "BEGINNER", loggingMode: "REPS_LOAD", contraindications: [], equipmentRequirements: [], muscles: [],
}));
export const planContent = (perDay = 4) => ({
  goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: 4, exercisesPerDay: perDay,
  weeklySchedule: [1, 2, 3, 4].map((d) => ({ day: `Day ${d}`, goal: "Toàn thân", cardio: "Khởi động", exercises: Array.from({ length: perDay }, (_, i) => { const c = CATALOG[(d - 1) * perDay + i]; return { exerciseId: c.id, order: i + 1, name: c.exerciseName, sets: 3, reps: "8-12", restSeconds: 75, note: "ok" }; }) })),
  progressionNotes: ["Tăng dần"], recoveryNotes: ["Ngủ đủ"], nutritionSummary: "Đủ protein",
});
export function fullPlanAnswer(prompt: string): string {
  const num = (re: RegExp, d: number) => Number(re.exec(prompt)?.[1] ?? d);
  const days = num(/DaysPerWeek: (\d+)/, 4), per = num(/ExercisesPerDay: (\d+)/, 4);
  const blocks = [...prompt.matchAll(/\[Day (\d+)\] ([^\n]*)\n((?:[^\n\[][^\n]*\n?)+)/g)];
  return JSON.stringify({ goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: days, exercisesPerDay: per,
    weeklySchedule: Array.from({ length: days }, (_, i) => { const b = blocks.find((x) => Number(x[1]) === i + 1) ?? blocks[0]; const lines = (b?.[3] ?? "").trim().split("\n").filter((l) => l.includes("|"));
      return { day: `Day ${i + 1}`, goal: (b?.[2] ?? "Toàn thân").trim(), cardio: "Khởi động", exercises: lines.slice(0, per).map((l, k) => ({ exerciseId: l.split("|")[0], order: k + 1, name: l.split("|")[1], sets: 3, reps: "8-12", restSeconds: 75, note: "ok" })) }; }),
    progressionNotes: ["x"], recoveryNotes: ["y"], nutritionSummary: "z" });
}
export async function startFakeFitness(): Promise<http.Server> {
  const srv = http.createServer((req, res) => {
    const send = (d: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(d)); };
    req.on("data", () => undefined); req.on("end", () => {
      const u = req.url ?? "";
      if (u.startsWith("/internal/exercises/for-ai-plans")) return send({ success: true, data: { exercises: CATALOG } });
      if (u.startsWith("/internal/exercises/muscle-profiles")) return send({ data: { exercises: [] } });
      if (u.startsWith("/internal/exercises/validate-plan-equipment")) return send({ data: { valid: true, violations: [], skippedNoUserEquipment: true } });
      res.statusCode = 404; send({});
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  process.env.FITNESS_SERVICE_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  delete process.env.FITNESS_LAMBDA_NAME; process.env.INTERNAL_SERVICE_SECRET = "skew-secret"; process.env.USER_SERVICE_URL = "http://127.0.0.1:1";
  return srv;
}
