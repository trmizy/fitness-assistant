import axios from "axios";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import type { AgentIdentity } from "../../services/fitness-agent-tools";
import { getActiveNutritionGoal, getCurrentNutritionProgram } from "../../services/enterprise-data/nutrition.reader";
import { getCurrentWorkoutProgram } from "../../services/enterprise-data/workout.reader";
import { GOAL_LABEL } from "../responses";
import type { Goal } from "../schema";
import type { ReadTopic } from "./router";
import { isProfileReadError, profileFailureAnswer } from "./profile-errors";

/**
 * ENTERPRISE DATA reads for "what is my current …?" questions. Mutable business facts (goal, PT contract, program, nutrition target,
 * body measurements) are ALWAYS read from the owning service with the caller's own bearer token — never from memory, RAG, or earlier
 * assistant messages — so an answer can neither be stale after a write nor cross users (the token IS the identity).
 */

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:3004";

export const readerDeps = {
  get: (url: string, authorization: string): Promise<{ status: number; data: any }> =>
    axios.get(url, { headers: { Authorization: authorization }, timeout: 4000, validateStatus: () => true }).then((r) => ({ status: r.status, data: r.data })),
};

export interface ReadResult {
  topic: ReadTopic;
  text: string;
  /** which authoritative source produced the facts (for the trace) */
  source: string;
  facts: Record<string, unknown>;
}

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const CONTRACT_LABEL: Record<string, string> = {
  PENDING_REVIEW: "đang chờ PT duyệt", PENDING_SIGNATURE: "đang chờ ký", PENDING_PAYMENT: "đang chờ thanh toán", ACTIVE: "đang hoạt động",
  COMPLETED: "đã hoàn thành", EXPIRED: "đã hết hạn", CANCELLED: "đã hủy", REJECTED: "bị PT từ chối",
};
const LIVE = new Set(["ACTIVE", "PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT"]);

const ptName = (c: any) => {
  const p = c.ptProfile ?? {};
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.fullName || p.displayName;
  return name || "một PT";
};

async function readContracts(identity: AgentIdentity, topic: "PT_STATUS" | "CONTRACT_STATUS"): Promise<ReadResult> {
  const r = await readerDeps.get(`${USER_SERVICE_URL}/contracts/client`, identity.authorizationHeader ?? "");
  if (r.status >= 400 || !Array.isArray(r.data)) return { topic, source: "user-service:/contracts/client", facts: { error: r.status }, text: "Mình chưa đọc được dữ liệu hợp đồng PT của bạn lúc này. Bạn thử lại sau giây lát nhé." };
  const all = r.data as any[];
  const live = all.filter((c) => LIVE.has(c.status));
  const past = all.filter((c) => !LIVE.has(c.status));
  const line = (c: any) => `${ptName(c)} — ${c.packageName ?? "gói tập"} (${CONTRACT_LABEL[c.status] ?? c.status})`;
  let text: string;
  if (live.length === 0) {
    text = past.length
      ? `Hiện bạn chưa có hợp đồng PT nào đang hiệu lực. Trước đây bạn có ${past.length} hợp đồng đã kết thúc (gần nhất: ${line(past[0])}). Nếu muốn tìm PT mới, bạn nhắn "tìm PT cho tôi" nhé.`
      : `Hiện bạn chưa có PT nào. Nếu muốn, bạn nhắn "tìm PT cho tôi" để mình lọc PT phù hợp — mình sẽ không tự đăng ký giúp bạn khi chưa được xác nhận.`;
  } else if (live.length === 1) {
    const c = live[0];
    text = topic === "PT_STATUS"
      ? (c.status === "ACTIVE" ? `Bạn đang tập với PT ${ptName(c)} — ${c.packageName ?? "gói tập"} (đang hoạt động).` : `Bạn đã gửi yêu cầu hợp đồng với PT ${ptName(c)} — ${c.packageName ?? "gói tập"}, hiện ${CONTRACT_LABEL[c.status] ?? c.status}; chưa phải hợp đồng đang hoạt động.`)
      : `Bạn có 1 hợp đồng PT: ${line(c)}.`;
  } else {
    text = `Bạn có ${live.length} hợp đồng PT đang hiệu lực/chờ xử lý:\n${live.slice(0, 5).map((c) => `• ${line(c)}`).join("\n")}`;
  }
  return { topic, source: "user-service:/contracts/client", facts: { total: all.length, live: live.length, statuses: live.map((c) => c.status) }, text };
}

async function readGoal(identity: AgentIdentity, question: string, deps: { getUserFitnessContext: (i: AgentIdentity) => Promise<{ profile: Record<string, unknown> }> }, topic: "GOAL" | "PROFILE_FACT"): Promise<ReadResult> {
  const ctx = await deps.getUserFitnessContext(identity);
  const p = ctx.profile as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : undefined);
  const goal = typeof p.goal === "string" ? (p.goal as Goal) : undefined;
  const s = normalizeAgentText(question);
  const facts = { goal, currentWeight: num("currentWeight"), targetWeight: num("targetWeight"), heightCm: num("heightCm"), age: num("age") };
  const parts: string[] = [];
  const asksRemaining = /(bao nhieu (kg|ky|can).*(nua|can (giam|tang))|con (bao nhieu|thieu)|cach muc tieu|can (giam|tang) (bao nhieu|may))/.test(s);
  if (asksRemaining && facts.currentWeight && facts.targetWeight) {
    const diff = Math.round(Math.abs(facts.currentWeight - facts.targetWeight) * 10) / 10;
    const verb = facts.currentWeight > facts.targetWeight ? "giảm" : "tăng";
    parts.push(`Bạn hiện ${facts.currentWeight}kg và cân nặng mục tiêu là ${facts.targetWeight}kg, tức còn cần ${verb} khoảng ${diff}kg nữa.`);
  } else if (/(chieu cao|\bcao\b|\bheight\b)/.test(s) && !/(nang|muc tieu)/.test(s)) parts.push(facts.heightCm ? `Chiều cao trong hồ sơ của bạn là ${facts.heightCm}cm.` : "Hồ sơ của bạn chưa có chiều cao.");
  else if (topic === "GOAL" || /muc tieu/.test(s) && !/can nang muc tieu|muc tieu can nang/.test(s)) {
    parts.push(goal ? `Mục tiêu hiện tại của bạn là ${GOAL_LABEL[goal]}.` : "Bạn chưa đặt mục tiêu chính trong hồ sơ.");
    if (facts.currentWeight && facts.targetWeight) parts.push(`Cân nặng hiện tại ${facts.currentWeight}kg, mục tiêu ${facts.targetWeight}kg.`);
  } else if (/(can nang muc tieu|muc tieu can nang)/.test(s)) {
    parts.push(facts.targetWeight ? `Cân nặng mục tiêu của bạn là ${facts.targetWeight}kg${facts.currentWeight ? ` (hiện ${facts.currentWeight}kg)` : ""}.` : "Bạn chưa đặt cân nặng mục tiêu.");
  } else if (/chieu cao/.test(s)) parts.push(facts.heightCm ? `Chiều cao trong hồ sơ của bạn là ${facts.heightCm}cm.` : "Hồ sơ của bạn chưa có chiều cao.");
  else if (/\btuoi\b/.test(s)) parts.push(facts.age ? `Bạn ${facts.age} tuổi (theo hồ sơ).` : "Hồ sơ của bạn chưa có tuổi.");
  else parts.push(facts.currentWeight ? `Cân nặng hiện tại của bạn là ${facts.currentWeight}kg (theo hồ sơ).` : "Hồ sơ của bạn chưa có cân nặng hiện tại.");
  return { topic, source: "user-profile (getUserFitnessContext)", facts, text: parts.join(" ") };
}

async function readNutritionTarget(identity: AgentIdentity): Promise<ReadResult> {
  // Phase 3 Batch 1 (docs/ai-product/phase3-batch1-context-foundation.md) — routed through the
  // Enterprise Data Layer's getActiveNutritionGoal instead of a raw /nutrition/goals call, so this
  // correctly excludes the id-less DEFAULT placeholder AND a non-ACTIVE row (the old code here only
  // checked `!g.id`, matching profile_extractor.ts's ACTIVE guard only by accident for the DEFAULT
  // case — a stored-but-not-ACTIVE goal would have been shown as the user's real target).
  const read = await getActiveNutritionGoal(identity);
  if (read.status === "error") return { topic: "NUTRITION_TARGET", source: "fitness-service:/nutrition/goals", facts: { error: read.message }, text: "Mình chưa đọc được mục tiêu dinh dưỡng của bạn lúc này. Bạn thử lại sau nhé." };
  if (read.status === "absent") return { topic: "NUTRITION_TARGET", source: "fitness-service:/nutrition/goals", facts: { stored: false }, text: "Bạn chưa có mục tiêu dinh dưỡng đã lưu. Khi bạn tạo lộ trình hoặc thực đơn, mình sẽ tính giúp và lưu lại sau khi bạn xác nhận." };
  const g = read.value;
  return {
    topic: "NUTRITION_TARGET", source: "fitness-service:/nutrition/goals",
    facts: { calories: g.calories, protein: g.protein, carbs: g.carbs, fat: g.fat },
    text: `Mục tiêu dinh dưỡng đang áp dụng của bạn là ${fmt(g.calories)} kcal/ngày — đạm ${g.protein}g, carb ${g.carbs}g, béo ${g.fat}g.`,
  };
}

async function readNutritionProgram(identity: AgentIdentity): Promise<ReadResult> {
  // Phase 3 Batch 1 — routed through getCurrentNutritionProgram (profileExtractor-backed, same
  // compacted shape/cache convention as readProgram above).
  const read = await getCurrentNutritionProgram(identity);
  if (read.status === "error") return { topic: "NUTRITION_PROGRAM", source: "fitness-service:/nutrition/plans/current", facts: { error: read.message }, text: "Mình chưa đọc được thực đơn hiện tại của bạn lúc này. Bạn thử lại sau nhé." };
  if (read.status === "absent") return { topic: "NUTRITION_PROGRAM", source: "fitness-service:/nutrition/plans/current", facts: { active: false }, text: "Hiện bạn chưa lưu thực đơn nào. Bạn nhắn \"tạo thực đơn cho tôi\" nếu muốn mình soạn một bản để bạn xem trước." };
  const plan = read.value;
  const name = plan.name ?? "thực đơn của bạn";
  return { topic: "NUTRITION_PROGRAM", source: "fitness-service:/nutrition/plans/current", facts: { active: true }, text: `Bạn đang theo thực đơn "${name}"${plan.mealsPerDay ? ` (${plan.mealsPerDay} bữa/ngày)` : ""}.` };
}

async function readProgram(identity: AgentIdentity): Promise<ReadResult> {
  // Phase 3 Batch 1 — routed through getCurrentWorkoutProgram, which reuses profileExtractor's own
  // compacted shape/cache instead of an independent raw /workouts/programs/current call (this was
  // the real, documented same-turn duplicate alongside workout_schedule_context.ts's own call).
  const read = await getCurrentWorkoutProgram(identity);
  if (read.status === "error") return { topic: "PROGRAM_STATUS", source: "fitness-service:/workouts/programs/current", facts: { error: read.message }, text: "Mình chưa đọc được chương trình tập hiện tại của bạn lúc này. Bạn thử lại sau nhé." };
  if (read.status === "absent") return { topic: "PROGRAM_STATUS", source: "fitness-service:/workouts/programs/current", facts: { active: false }, text: "Hiện bạn chưa có chương trình tập nào đang áp dụng. Bạn nhắn \"tìm chương trình tập cho tôi\" hoặc \"tạo lịch tập cho tôi\" nếu muốn bắt đầu." };
  const program = read.value;
  const days = program.dayCount ?? program.daysPerWeek;
  return { topic: "PROGRAM_STATUS", source: "fitness-service:/workouts/programs/current", facts: { active: true, name: program.name }, text: `Bạn đang theo chương trình "${program.name}"${days ? `, khoảng ${days} buổi/tuần` : ""}.` };
}

/**
 * Phase 3 Batch 5 defect (found by the unified-coach E2E suite, journey 7): `readerDeps.get`'s
 * `validateStatus: () => true` only suppresses HTTP 4xx/5xx from throwing — a genuine network-level
 * failure (connection refused/timeout) still rejects, and none of readContracts/readNutritionTarget/
 * etc. ever catch it (each only handles the already-resolved `{status>=400}` case). Uncaught, this
 * crashed the WHOLE turn (an unhandled rejection all the way up through runGlobalTurn's own MULTI
 * READ handling), not just degrading that one read honestly the way an HTTP error status already
 * does. Fixed at this single dispatcher — every reader function already has its own honest
 * degraded-read text for the HTTP-status case; a thrown rejection now gets the same treatment,
 * never a crashed turn.
 */
export async function readState(topic: ReadTopic, identity: AgentIdentity, question: string, deps: { getUserFitnessContext: (i: AgentIdentity) => Promise<{ profile: Record<string, unknown> }> }): Promise<ReadResult | null> {
  try {
    switch (topic) {
      case "PT_STATUS":
      case "CONTRACT_STATUS": return await readContracts(identity, topic);
      case "GOAL":
      case "PROFILE_FACT": return await readGoal(identity, question, deps, topic);
      case "NUTRITION_TARGET": return await readNutritionTarget(identity);
      case "NUTRITION_PROGRAM": return await readNutritionProgram(identity);
      case "PROGRAM_STATUS": return await readProgram(identity);
      case "ROADMAP_STATUS":
      case "SCHEDULE": return null; // answered by the existing deterministic schedule context (workout_schedule_context) in the chat pipeline
      default: return null;
    }
  } catch (err) {
    // Batch 5 defect fix (docs/ai-product/phase3-batch5-rollout-readiness.md §19): this catch used to turn EVERY rejection — including
    // a 401/403 and an unexpected 500 from the profile read — into a successful 200 answer. An authorization failure must reach the
    // caller, and a profile-read error is classified by profile-errors.ts (known conditions get guidance; anything else stays an error).
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) throw err;
    // GOAL / PROFILE_FACT read the profile itself: only a classified profile condition may become guidance; any other error from that read is a real error.
    const profileTopic = topic === "GOAL" || topic === "PROFILE_FACT";
    if (isProfileReadError(err) || profileTopic) {
      const answer = isProfileReadError(err) ? profileFailureAnswer(err, { userId: identity.userId }) : null;
      if (answer) return { topic, source: "unavailable", facts: { error: true }, text: answer };
      throw err;
    }
    return { topic, source: "unavailable", facts: { error: true }, text: "Mình chưa đọc được dữ liệu này lúc này — bạn thử lại sau giây lát nhé." };
  }
}
