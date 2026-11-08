// Smoke (REAL HTTP/API, isolated test stack): one persona, a few nutrition turns, prints the raw answer shape.
// Usage (repo root): GATEWAY_URL=http://localhost:13000 node test/ai-quality-eval/smoke.mjs
import { registerUser, putProfile, say, http } from "../ai-chat-full-verification/lib.mjs";

const u = await registerUser(`aiq.smoke.${Date.now().toString(36)}@gymini-test.local`, "AIQ Smoke");
const p = await putProfile(u, { age: 30, gender: "MALE", heightCm: 175, goal: "WEIGHT_LOSS", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 85, targetWeight: 78, hasCompletedOnboarding: true });
console.log("profile", p.status);
const g = await http("GET", "/nutrition/goals", { token: u.token });
console.log("goal", g.status, JSON.stringify(g.json).slice(0, 500));
for (const q of process.argv.slice(2).length ? process.argv.slice(2) : ["Một ngày tôi cần bao nhiêu calo?", "Protein nên ăn bao nhiêu gram mỗi ngày?"]) {
  const t0 = Date.now(), r = await say(u, q);
  console.log("\n### " + q, r.status, Date.now() - t0 + "ms");
  console.log("model", r.data?.modelUsed, "tokens", r.data?.promptTokens, r.data?.completionTokens, "fallback", r.data?.usedFallback, r.data?.fallbackReason ?? "");
  console.log(r.answer);
  console.log("meta", JSON.stringify({ intent: r.data?.intent, route: r.data?.route, sources: (r.data?.sources ?? r.data?.citations ?? []).length, blocks: (r.data?.structuredBlocks ?? []).map((b) => b.type) }));
}
