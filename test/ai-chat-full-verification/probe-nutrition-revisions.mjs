// REAL HTTP/API probe (Phase 3, Nutrition AI): do the authoritative calorie/macro TARGET and the food EXCLUSIONS survive chat revisions of a
// nutrition draft? Real gateway + ai-service (+ queue worker) + fitness-service, isolated test DBs, real generation by the configured model.
// Nothing is confirmed/saved: only drafts. Usage (repo root): GATEWAY_URL=http://localhost:13000 node test/ai-chat-full-verification/probe-nutrition-revisions.mjs
import fs from "node:fs";
import { registerUser, putProfile, say, sleep } from "./lib.mjs";

const stamp = Date.now().toString(36);
const u = await registerUser(`probe.nut.${stamp}@gymini-test.local`, "Probe Nutrition");
const p = await putProfile(u, { age: 30, gender: "MALE", heightCm: 175, goal: "WEIGHT_LOSS", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 85, targetWeight: 78, hasCompletedOnboarding: true });
if (p.status !== 200) throw new Error("profile " + p.status);

const FISH = /fish|salmon|tuna|cod\b|tilapia|sardine|mackerel|trout|shrimp|haddock|herring/i;
const BEEF = /beef|steak|veal|brisket|sirloin/i;
const PEANUT = /peanut/i;
const previewOf = (r) => {
  const d = r.raw?.data ?? r.raw ?? {};
  return (Array.isArray(d.structuredBlocks) ? d.structuredBlocks : []).find((b) => b?.type === "NUTRITION_PLAN_PREVIEW") ?? null;
};
const foodNames = (b) => (b?.nutritionDays ?? []).flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => String(i.name))));
const summarize = (b) => b ? {
  kcal: b.dailyCaloriesTarget, protein: b.proteinTargetGrams, carbs: b.carbTargetGrams, fat: b.fatTargetGrams, meals: b.mealsPerDay,
  excluded: b.excludedFoods, days: (b.nutritionDays ?? []).length,
  fish: foodNames(b).filter((n) => FISH.test(n)).length, beef: foodNames(b).filter((n) => BEEF.test(n)).length, peanut: foodNames(b).filter((n) => PEANUT.test(n)).length,
} : null;

async function until(sid, probeText = "Thực đơn xong chưa?", max = 30) {
  for (let i = 0; i < max; i++) {
    const r = await say(u, probeText, sid);
    const b = previewOf(r);
    if (b) return { r, b };
    await sleep(5000);
  }
  return { r: null, b: null };
}

const log = [];
const record = (step, b, note = "") => { const row = { step, note, ...summarize(b) }; log.push(row); console.log(JSON.stringify(row)); };

let r = await say(u, "Tạo thực đơn, tôi không ăn cá.");
const sid = r.sessionId;
r = await say(u, "À tôi cũng không ăn thịt bò.", sid);
r = await say(u, "4 bữa", sid);
let cur = previewOf(r) ? { r, b: previewOf(r) } : await until(sid);
record("1 initial (no fish, no beef, 4 meals)", cur.b);
const baseline = summarize(cur.b);

r = await say(u, "Ít bữa hơn.", sid);
cur = previewOf(r) && /Ít bữa|giảm.*bữa|\d bữa/.test(r.answer) ? { r, b: previewOf(r) } : await until(sid, "Xong chưa?");
record("2 'Ít bữa hơn' (fewer meals)", cur.b, String(cur.r?.answer ?? "").slice(0, 100));

r = await say(u, "Tôi dị ứng đậu phộng.", sid);
cur = previewOf(r) ? { r, b: previewOf(r) } : await until(sid, "Xong chưa?");
record("3 + peanut allergy", cur.b, String(cur.r?.answer ?? "").slice(0, 100));

const final = summarize(cur.b);
const checks = {
  targetUnchanged: final && baseline && final.kcal === baseline.kcal && final.protein === baseline.protein && final.carbs === baseline.carbs && final.fat === baseline.fat,
  exclusionsAccumulated: final && ["cá", "bò", "đậu phộng"].every((w) => final.excluded.some((e) => String(e).toLowerCase().includes(w))),
  noFishBeefPeanut: final && final.fish === 0 && final.beef === 0 && final.peanut === 0,
  mealsReduced: final && baseline && final.meals < baseline.meals,
};
console.log("CHECKS", JSON.stringify(checks));
fs.writeFileSync("test/ai-chat-full-verification/results/probe-nutrition-revisions.json", JSON.stringify({ at: new Date().toISOString(), baseline, final, checks, log }, null, 2));
