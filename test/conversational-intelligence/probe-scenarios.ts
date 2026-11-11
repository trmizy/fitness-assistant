// Read-only policy probe for the special scenarios (no DB, no network). Usage: node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/probe-scenarios.ts
import { semanticTurn, withCiState } from "../../backend/services/ai-service/src/conversational-intelligence";

const slotKeys = new Set(["goal", "age", "heightCm", "currentWeightKg", "gender", "targetWeight"]);
const base = { goal: "MUSCLE_GAIN", age: 22, heightCm: 173, currentWeight: 80, gender: "MALE", experience: "BEGINNER" };

async function run(title: string, profile: Record<string, unknown>, turns: string[], slot: string | null = "targetWeight", keys = slotKeys) {
  console.log(`\n=== ${title}`);
  let known: Record<string, unknown> = {};
  for (const t of turns) {
    const r = await semanticTurn({ text: t, userId: "probe", profile, known, expectedSlot: slot, slotKeys: keys });
    const patch = JSON.stringify(r.decision.patch ?? {});
    console.log(`> ${t}\n  → ${r.decision.action} | intent=${r.interp.primaryIntent} | patch=${patch}\n    ${(r.decision.text ?? r.decision.preface ?? "(legacy pipeline continues)").replace(/\n/g, " ").slice(0, 200)}`);
    known = withCiState({ ...known, ...(r.decision.patch ?? {}) }, r.decision.ci);
  }
}

async function main() {
  await run("#52 explanation + action", base, ["tại sao bạn nghĩ tôi nên giảm mỡ? nếu hợp lý thì đổi mục tiêu giúp tôi"]);
  await run("#53 natural negation", base, ["tôi không muốn xuống 70", "không phải 72", "đừng đổi mục tiêu"]);
  await run("#54 value references (3 checkpoints → middle resolvable; 2 → ambiguous)", { ...base, goal: "WEIGHT_LOSS" }, ["bạn tự đề xuất đi", "mức giữa", "lấy mức thấp hơn"]);
  await run("#51 ask AI to decide sessions/week", base, ["tôi không biết nên tập mấy buổi"], "daysPerWeek", new Set(["daysPerWeek", "sessionMinutes"]));
  await run("#51 ask AI to decide meals", base, ["bạn tự đề xuất đi"], "mealsPerDay", new Set(["mealsPerDay"]));
  await run("budget is the user's decision", base, ["bạn chọn giúp tôi"], "budgetVnd", new Set(["budgetVnd", "days"]));
  await run("insufficient facts for a recommendation", { goal: "WEIGHT_LOSS" }, ["hãy đề xuất cho tôi"]);
  await run("multi-turn belief 70 → propose → 74 → actually 72", base, ["mục tiêu 70kg", "hãy đề xuất", "74kg", "không phải 74, là 72"]);
}
main().catch((e) => { console.error(e); process.exit(1); });
