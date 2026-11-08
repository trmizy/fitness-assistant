/**
 * Data-backed guidance turns (see exercise-guidance.ts for the why): the user's real first/next session, "how do I do <exercise>", and the
 * home/no-equipment question answered from the exercise library. Each returns null when it does not apply, so normal dispatch continues.
 */
import { prisma } from "../repositories/conversation.repository";
import { detectWorkoutScheduleIntent, workoutScheduleContextResolver } from "../llm/workout_schedule_context";
import type { AgentIdentity } from "./fitness-agent-tools";
import { fitnessAgentTools } from "./fitness-agent-tools";
import {
  isFirstSessionQuestion, parseExerciseHowTo, buildSessionGuidance, buildExerciseHowTo, isHomeNoEquipmentQuestion,
  pickHomeExercises, buildHomeNoEquipmentAnswer, type GuidedExercise,
} from "./exercise-guidance";

type Turn = { answer: string; blocks: never[] } | null;
type Tools = Pick<typeof fitnessAgentTools, "searchExerciseByName" | "listExercises">;

async function withInstructions(identity: AgentIdentity, tools: Tools, items: GuidedExercise[]): Promise<GuidedExercise[]> {
  return Promise.all(items.map(async (e) => {
    const found = await tools.searchExerciseByName(identity, e.name).catch(() => null) as ({ instructions?: string | null } | null);
    return { ...e, instructions: found?.instructions ?? null };
  }));
}

export async function tryFirstSessionGuidance(question: string, identity: AgentIdentity, sessionId: string, tools: Tools): Promise<Turn> {
  if (!isFirstSessionQuestion(question)) return null;
  // 1) the draft the user is looking at in THIS chat; 2) the schedule they already saved.
  const draft = await prisma.fitnessAgentAction.findFirst({
    where: { userId: identity.userId, sessionId, kind: "CREATE_WORKOUT_PLAN", status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const day = (draft?.payload as { weeklySchedule?: { day?: string; exercises?: { name: string; sets?: number; reps?: string | number; restSeconds?: number }[] }[] } | null)?.weeklySchedule?.[0];
  if (day?.exercises?.length) {
    const items = await withInstructions(identity, tools, day.exercises.map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds })));
    return { answer: buildSessionGuidance({ title: day.day, source: "DRAFT", exercises: items }), blocks: [] };
  }
  try {
    const intent = detectWorkoutScheduleIntent("lịch tập tuần này");
    const ctx = await workoutScheduleContextResolver.resolve(intent, identity.userId, identity.authorizationHeader);
    const saved = ctx.days?.find((d) => d.exercises.length > 0) ?? (ctx.exercises?.length ? { title: ctx.workoutName, exercises: ctx.exercises } : null);
    if (saved) {
      const items = await withInstructions(identity, tools, saved.exercises.map((e) => ({ name: e.name, sets: e.sets ?? undefined, reps: e.reps ?? undefined, restSeconds: e.restSeconds ?? undefined })));
      return { answer: buildSessionGuidance({ title: saved.title, source: "SAVED", exercises: items }), blocks: [] };
    }
  } catch { /* fall through to the honest "no schedule" answer */ }
  return {
    answer: "Hiện bạn **chưa có lịch tập nào** (cả bản nháp lẫn lịch đã lưu), nên mình chưa có buổi tập cụ thể để hướng dẫn — mình không muốn bịa ra một buổi không thuộc lịch của bạn.\n\nBạn nhắn “Tạo lịch tập cho tôi” (hoặc “Lập lộ trình và kế hoạch tập, dinh dưỡng cho tôi”) — mình sẽ cho xem bản nháp, **chỉ lưu khi bạn xác nhận**; sau đó mình hướng dẫn từng bước buổi đầu tiên.",
    blocks: [],
  };
}

export async function tryExerciseHowTo(question: string, identity: AgentIdentity, tools: Tools): Promise<Turn> {
  const name = parseExerciseHowTo(question);
  if (!name) return null;
  const found = await tools.searchExerciseByName(identity, name).catch(() => null) as ({ exerciseName: string; instructions?: string | null } | null);
  if (!found) return null; // not a library exercise (e.g. a generic question): let the normal chat answer
  return { answer: buildExerciseHowTo(found.exerciseName, found.instructions), blocks: [] };
}

export async function tryHomeNoEquipmentAnswer(question: string, identity: AgentIdentity, tools: Tools): Promise<Turn> {
  if (!isHomeNoEquipmentQuestion(question)) return null;
  const parts = ["LOWER_BODY", "UPPER_BODY", "CORE"] as const;
  const lists = await Promise.all(parts.map((bodyPart) => tools.listExercises(identity, { typeOfEquipment: "BODYWEIGHT", bodyPart, limit: 60 }).catch(() => [])));
  const byPart = Object.fromEntries(parts.map((p, i) => [p, lists[i]])) as Parameters<typeof pickHomeExercises>[0];
  return { answer: buildHomeNoEquipmentAnswer(pickHomeExercises(byPart)), blocks: [] };
}

import { parseDishToAdd, buildDishAnalysis, dishNotFoundAnswer, baseIngredientFor, buildPartialDishAnalysis } from "./dish-addition";
import { profileExtractor } from "../llm/profile_extractor";

/** "thêm bún bò vào thực đơn": the dish's real numbers + how it fits the saved daily target. Nothing is saved. */
export async function tryDishAdditionAnalysis(question: string, identity: AgentIdentity, tools: Pick<typeof fitnessAgentTools, "searchFood">): Promise<Turn> {
  const asked = parseDishToAdd(question);
  if (!asked) return null;
  const food = await tools.searchFood(identity, asked).catch(() => null);
  let dailyCalories: number | null = null;
  const loadTarget = async () => { try { dailyCalories = (await profileExtractor.extract(identity.userId, identity.authorizationHeader)).profile.nutritionGoal?.calories ?? null; } catch { /* analysis without the share */ } };
  if (!food) {
    const base = baseIngredientFor(asked);
    const baseFood = base ? await tools.searchFood(identity, base.term).catch(() => null) : null;
    if (base && baseFood) { await loadTarget(); return { answer: buildPartialDishAnalysis(baseFood, { asked, label: base.label, dailyCalories }), blocks: [] }; }
    return { answer: dishNotFoundAnswer(asked), blocks: [] };
  }
  await loadTarget();
  return { answer: buildDishAnalysis(food, { asked, dailyCalories }), blocks: [] };
}
