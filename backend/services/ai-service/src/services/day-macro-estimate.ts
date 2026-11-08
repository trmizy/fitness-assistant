/**
 * "Tính macro cả ngày" — a free-text day description ("sáng 1 tô phở bò, trưa 2 chén cơm + 150g ức gà, tối 1 quả chuối")
 * turned into per-item and total calories/macros, compared with the user's saved NutritionGoal.
 *
 * Same precedent as meal-log-extractor.ts: the LLM only extracts WHICH foods and HOW MUCH (text extraction); every nutrition
 * number comes from a real Food row (curated everyday foods first — fitness-service prisma/seed_everyday_foods.ts —, then a
 * few USDA FNDDS composite dishes, then the regular catalog search). Household units are converted with the documented
 * estimate table below, always marked as an estimate and editable by the user. Nothing is written here: saving to the diary
 * is a separate, explicit user action through the existing POST /nutrition (frontend "Lưu vào nhật ký").
 */
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { callLlmJson } from "../llm/json_llm_call.util";
import { requestService } from "../clients/service-lambda.client";
import { fitnessAgentTools, type AgentIdentity } from "./fitness-agent-tools";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export interface DayEstimateItem {
  mention: string;
  mealType: MealType | null;
  food: { id: string; name: string; displayName: string; per100g: { calories: number; protein: number; carbs: number; fat: number } } | null;
  grams: number | null;
  gramsSource: "user" | "unit_estimate" | "default_portion" | null;
  unitNote: string | null;
  match: "curated" | "dish" | "search" | "none";
  calories: number; protein: number; carbs: number; fat: number;
}
export interface DayEstimate {
  items: DayEstimateItem[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
  goal: { calories: number; protein: number; carbs: number; fat: number; source: "ACTIVE_GOAL" | "COMPUTED" } | null;
  unmatched: string[];
  notes: string[];
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const round1 = (x: number) => Math.round(x * 10) / 10;

// ── 1. extraction ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ExtractSchema = z.object({
  items: z.array(z.object({
    food: z.string().min(1).max(80),
    quantity: z.number().positive().max(5000).nullable().optional(),
    unit: z.string().max(20).nullable().optional(),
    meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable().optional(),
  })).max(30),
});
type Extracted = z.infer<typeof ExtractSchema>["items"];

export async function extractDayFoods(text: string, userId: string): Promise<Extracted> {
  const prompt = `Trích xuất DANH SÁCH MÓN ĂN người dùng đã ăn từ đoạn mô tả dưới đây. Không tính calo, không thêm món không được nhắc.

Đoạn mô tả: "${text.replace(/"/g, '\\"').slice(0, 1500)}"

Trả về CHÍNH XÁC một object JSON: {"items":[{"food":"...","quantity":số hoặc null,"unit":"...","meal":"breakfast|lunch|dinner|snack"|null}]}
- food: tên món/nguyên liệu bằng tiếng Việt như người dùng viết, KHÔNG kèm số lượng (ví dụ "phở bò", "cơm trắng", "ức gà luộc", "chuối").
- quantity + unit: đúng như người dùng nói ("150" + "g", "2" + "chén", "1" + "tô", "1" + "quả", "0.5" + "ổ"); null nếu không nói.
- meal: bữa nếu có nhắc (sáng/trưa/tối/ăn vặt, bữa phụ), null nếu không rõ.
- Món ghép nhiều thứ trong một câu ("cơm + ức gà") là NHIỀU item riêng.
Chỉ trả về JSON.`;
  const out = await callLlmJson(prompt, ExtractSchema, { userId, phase: "day-macro-extraction", numPredict: 600, attempts: 2, logPrefix: "[day-macro]", redactErrorDetail: true });
  if (!out?.items?.length) return fallbackExtract(text);
  const named = mealsNamedIn(text);
  // the model sometimes keeps "chuối và 1 hộp sữa chua" as ONE item: split joined items deterministically
  return out.items.map((it): Extracted[number] => ({ ...it, food: it.food.normalize("NFC"), meal: it.meal && named.has(it.meal) ? it.meal : null })).flatMap((it): Extracted => (/\s(và|với|\+)\s/u.test(it.food)
    ? fallbackExtract(it.food).map((p, k) => ({ ...p, quantity: k === 0 ? it.quantity ?? p.quantity : p.quantity, unit: k === 0 ? it.unit ?? p.unit : p.unit, meal: it.meal ?? p.meal }))
    : [it])).filter((i) => !isRequestPhrase(i.food)).slice(0, 30);
}

// Meal words are matched WITH diacritics: folded "toi" is both "tôi" (I) and "tối" (evening), so "Hôm nay tôi ăn 1 tô phở"
// used to file the phở under dinner (live check 2026-11-08). Same reason the LLM's meal is kept only when the text names it.
const MEAL_WORDS: Array<[MealType, RegExp]> = [
  ["breakfast", /(^|[\s,.;:(])(bữa\s+)?sáng(?=$|[\s,.;:)])/iu],
  ["lunch", /(^|[\s,.;:(])(bữa\s+)?trưa(?=$|[\s,.;:)])/iu],
  ["dinner", /(^|[\s,.;:(])(bữa\s+)?tối(?=$|[\s,.;:)])/iu],
  ["snack", /(^|[\s,.;:(])(bữa\s+phụ|ăn\s+vặt|bữa\s+xế|chiều)(?=$|[\s,.;:)])/iu],
];
export function mealWord(text: string): MealType | null {
  const t = text.normalize("NFC");
  let best: { meal: MealType; at: number } | null = null;
  for (const [meal, re] of MEAL_WORDS) { const m = re.exec(t); if (m && (!best || m.index < best.at)) best = { meal, at: m.index }; }
  return best?.meal ?? null;
}
// The ask itself ("tính macro giúp", "bao nhiêu calo") is not a food — the live chat check listed it as an unmatched item.
export function isRequestPhrase(food: string): boolean {
  return /^(tinh|giup|cho (toi|minh|em)|bao nhieu|duoc bao nhieu|het bao nhieu|macro|calo|kcal)\b|\b(tinh (giup|ho|macro|calo)|macro giup|calo giup)\b/.test(fold(food));
}
export function mealsNamedIn(text: string): Set<MealType> {
  const t = text.normalize("NFC");
  return new Set(MEAL_WORDS.filter(([, re]) => re.test(t)).map(([meal]) => meal));
}

/** Deterministic fallback when the model is unavailable: "150g ức gà, 2 chén cơm và 1 quả chuối". */
export function fallbackExtract(text: string): Extracted {
  const out: Extracted = [];
  let meal: MealType | null = null;
  // (JS \b is ASCII-only — "\bvà\b" never matched after "à" — so the connectives are delimited by whitespace)
  for (const raw of text.normalize("NFC").split(/[,;\n+]|\s(?:và|với|voi|va)\s/iu)) {
    let part = raw.trim();
    const m = mealWord(part);
    if (m) meal = m;
    part = part.replace(/^(bữa\s+)?(sáng|trưa|tối|chiều|ăn vặt|bữa phụ)\s*(nay)?\s*(tôi|mình|em)?\s*(ăn|uống)?\s*/iu, "").replace(/^(hôm nay|hôm qua)\s*/iu, "").replace(/^(tôi|mình|em)\s+(đã\s+)?(ăn|uống)\s+/iu, "").trim();
    if (!part) continue;
    const q = part.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|gram|ml|kg|chén|bát|tô|đĩa|quả|trái|ổ|lát|miếng|hộp|ly|cốc|muỗng|thìa|cái|con|củ|lạng)?\s+(.+)$/iu);
    if (q) out.push({ food: q[3].trim(), quantity: Number(q[1].replace(",", ".")), unit: q[2] ?? null, meal });
    else out.push({ food: part, quantity: null, unit: null, meal });
  }
  return out.filter((i) => fold(i.food).length >= 2 && !isRequestPhrase(i.food)).slice(0, 30);
}

// ── 2. household units → grams (ESTIMATES, shown as such and editable) ────────────────────────────────────────────────────
// No official per-bowl weight was found (Viện Dinh dưỡng publishes no "1 chén cơm = x g" table in reachable sources; consumer
// sites disagree), so these are conservative typical portions, documented, never presented as measured.
interface UnitRule { unit: RegExp; food?: RegExp; grams: number; note: string }
const UNIT_RULES: UnitRule[] = [
  { unit: /^(g|gr|gram|gam)$/, grams: 1, note: "" },
  { unit: /^kg$/, grams: 1000, note: "" },
  { unit: /^lang$/, grams: 100, note: "1 lạng = 100 g" },
  { unit: /^ml$/, grams: 1, note: "1 ml ≈ 1 g (ước tính)" },
  { unit: /^(chen|bat)$/, food: /\b(com|chao|xoi|bun|mien)\b/, grams: 150, note: "1 chén/bát ≈ 150 g (ước tính)" },
  { unit: /^(chen|bat)$/, grams: 250, note: "1 bát (canh/súp) ≈ 250 g (ước tính)" },
  { unit: /^to$/, grams: 500, note: "1 tô (cả nước dùng) ≈ 500 g (ước tính)" },
  { unit: /^dia$/, grams: 350, note: "1 đĩa ≈ 350 g (ước tính)" },
  { unit: /^(qua|trai)$/, food: /\btrung\b/, grams: 50, note: "1 quả trứng ≈ 50 g (ước tính)" },
  { unit: /^(qua|trai)$/, food: /\bchuoi\b/, grams: 120, note: "1 quả chuối ≈ 120 g phần ăn được (ước tính)" },
  { unit: /^(qua|trai)$/, food: /\b(tao|cam|le)\b/, grams: 160, note: "1 quả ≈ 160 g (ước tính)" },
  { unit: /^(qua|trai)$/, food: /\bbo\b/, grams: 140, note: "1 quả bơ ≈ 140 g phần ăn được (ước tính)" },
  { unit: /^(qua|trai)$/, grams: 150, note: "1 quả ≈ 150 g (ước tính)" },
  { unit: /^(o|cai)$/, food: /\bbanh mi\b/, grams: 100, note: "1 ổ bánh mì ≈ 100 g (ước tính)" },
  { unit: /^lat$/, food: /\bbanh mi\b/, grams: 30, note: "1 lát bánh mì ≈ 30 g (ước tính)" },
  { unit: /^lat$/, grams: 30, note: "1 lát ≈ 30 g (ước tính)" },
  { unit: /^mieng$/, grams: 100, note: "1 miếng ≈ 100 g (ước tính)" },
  { unit: /^hop$/, food: /\bsua chua\b/, grams: 100, note: "1 hộp sữa chua ≈ 100 g (ước tính)" },
  { unit: /^hop$/, grams: 180, note: "1 hộp ≈ 180 ml (ước tính)" },
  { unit: /^(ly|coc)$/, grams: 250, note: "1 ly/cốc ≈ 250 ml (ước tính)" },
  { unit: /^(muong|thia)$/, food: /\b(dau|mo)\b/, grams: 14, note: "1 muỗng canh dầu ≈ 14 g (ước tính)" },
  { unit: /^(muong|thia)$/, grams: 15, note: "1 muỗng canh ≈ 15 g (ước tính)" },
  { unit: /^con$/, food: /\btom\b/, grams: 15, note: "1 con tôm ≈ 15 g (ước tính)" },
  { unit: /^cu$/, grams: 150, note: "1 củ ≈ 150 g (ước tính)" },
];
// No quantity at all → one typical portion of that food (estimate).
const DEFAULT_PORTIONS: Array<{ food: RegExp; grams: number; note: string }> = [
  { food: /\b(pho|bun bo|hu tieu|mi quang|bun rieu|chao)\b/, grams: 500, note: "1 tô" },
  { food: /\b(com tam|com chien|com rang)\b/, grams: 350, note: "1 đĩa" },
  { food: /\bcom\b/, grams: 150, note: "1 chén" },
  { food: /\bbanh mi\b/, grams: 100, note: "1 ổ" },
  { food: /\btrung\b/, grams: 50, note: "1 quả" },
  { food: /\b(chuoi|tao|cam|xoai|oi|le)\b/, grams: 150, note: "1 quả" },
  { food: /\b(sua|sua dau nanh)\b/, grams: 250, note: "1 ly" },
  { food: /\b(dau an|dau o liu)\b/, grams: 10, note: "2 muỗng cà phê" },
];
const DEFAULT_GRAMS = 100;

export function resolveGrams(mention: string, quantity: number | null | undefined, unit: string | null | undefined): { grams: number; source: "user" | "unit_estimate" | "default_portion"; note: string | null } {
  const f = fold(mention), u = fold(unit ?? "");
  if (quantity && u) {
    const rule = UNIT_RULES.find((r) => r.unit.test(u) && (!r.food || r.food.test(f)));
    if (rule) return { grams: Math.round(quantity * rule.grams), source: rule.grams === 1 || rule.unit.test("kg") ? "user" : "unit_estimate", note: rule.note || null };
  }
  const portion = DEFAULT_PORTIONS.find((p) => p.food.test(f));
  const mult = quantity && !u ? quantity : 1; // "2 trứng" without a unit word
  if (portion) return { grams: Math.round(mult * portion.grams), source: "default_portion", note: `${mult !== 1 ? `${mult} × ` : ""}${portion.note} ≈ ${portion.grams} g (ước tính)` };
  return { grams: Math.round(mult * DEFAULT_GRAMS), source: "default_portion", note: `chưa rõ lượng — tạm tính ${mult !== 1 ? `${mult} × ` : ""}${DEFAULT_GRAMS} g` };
}

// ── 3. food matching ─────────────────────────────────────────────────────────────────────────────────────────────────────
type CatalogFood = { id: string; name: string; calories: number; protein: number; carbs: number; fat?: number; fats?: number; viName?: string | null; curated?: boolean };
let curatedCache: { at: number; foods: CatalogFood[] } | null = null;
async function curatedFoods(userId: string): Promise<CatalogFood[]> {
  if (curatedCache && Date.now() - curatedCache.at < 10 * 60_000) return curatedCache.foods;
  try {
    const resp = await requestService<any>({ service: "fitness", method: "GET", path: "/internal/foods/for-ai-nutrition", timeoutMs: 10000,
      headers: { ...(process.env.INTERNAL_SERVICE_SECRET ? { "x-internal-token": process.env.INTERNAL_SERVICE_SECRET } : {}), "x-user-id": userId } });
    const foods: CatalogFood[] = (resp?.data?.data?.foods ?? []).filter((f: CatalogFood) => f.curated && f.viName);
    curatedCache = { at: Date.now(), foods };
    return foods;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[day-macro] curated food list unavailable; using catalog search only");
    return [];
  }
}

// Vietnamese composite dishes that exist as USDA FNDDS rows (survey foods, real per-100 g values incl. broth/sauce).
const DISHES: Array<{ match: RegExp; usdaName: string; display: string }> = [
  { match: /\bpho (bo|ga|tai|nam|bo vien)\b|\bpho\b(?!.*chay)/, usdaName: "Soup, pho, with meat", display: "Phở (có thịt)" },
  { match: /\bpho chay\b/, usdaName: "Soup, pho, no meat", display: "Phở chay" },
  { match: /\b(com chien|com rang)\b.*\bbo\b/, usdaName: "Rice, fried, with beef", display: "Cơm chiên bò" },
  { match: /\b(com chien|com rang)\b.*\bga\b/, usdaName: "Rice, fried, with chicken", display: "Cơm chiên gà" },
  { match: /\b(com chien|com rang)\b.*\btom\b/, usdaName: "Rice, fried, with shrimp", display: "Cơm chiên tôm" },
  { match: /\b(com chien|com rang)\b/, usdaName: "Rice, fried, NFS", display: "Cơm chiên" },
  { match: /\b(cha gio|nem ran|nem)\b/, usdaName: "Egg roll, with beef and/or pork", display: "Chả giò / nem rán" },
  { match: /\bxoi\b/, usdaName: "Rice, white, cooked, glutinous", display: "Xôi (gạo nếp nấu chín)" },
];

function curatedMatch(mention: string, foods: CatalogFood[]): CatalogFood | null {
  const m = fold(mention), mTokens = m.split(" ").filter((t) => t.length > 1);
  let best: { f: CatalogFood; score: number } | null = null;
  for (const f of foods) {
    const core = fold(String(f.viName).replace(/\(.*?\)/g, " ")), all = fold(String(f.viName));
    const coreTokens = core.split(" ").filter((t) => t.length > 1);
    if (!coreTokens.length) continue;
    const hit = coreTokens.filter((t) => mTokens.includes(t)).length;
    const covered = hit / coreTokens.length;
    const mentionCovered = mTokens.filter((t) => all.split(" ").includes(t)).length / Math.max(1, mTokens.length);
    // exact-name bonus only: a substring bonus made "trứng luộc" pick "Lòng trắng trứng luộc" over "Trứng gà luộc"
    const score = covered * 0.6 + mentionCovered * 0.4 + (core.trim() === m || all === m ? 0.3 : 0);
    if (hit && score >= 0.6 && (!best || score > best.score)) best = { f, score };
  }
  return best?.f ?? null;
}

async function matchFood(identity: AgentIdentity, mention: string, curated: CatalogFood[]): Promise<{ food: DayEstimateItem["food"]; match: DayEstimateItem["match"] }> {
  const per100 = (f: { calories: number; protein: number; carbs: number; fat?: number; fats?: number }) =>
    ({ calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat ?? f.fats ?? 0 });
  const f = fold(mention);
  const dish = DISHES.find((d) => d.match.test(f));
  if (dish) {
    try {
      const found = await fitnessAgentTools.searchFood(identity, dish.usdaName);
      if (found && found.name.toLowerCase() === dish.usdaName.toLowerCase()) return { food: { id: found.id, name: found.name, displayName: dish.display, per100g: per100(found) }, match: "dish" };
    } catch { /* fall through */ }
  }
  const c = curatedMatch(mention, curated);
  if (c) return { food: { id: c.id, name: c.name, displayName: String(c.viName), per100g: per100(c) }, match: "curated" };
  // "canh cải" / "canh bí" — a vegetable soup: counted as its vegetable (broth/meat not included, said so in the note)
  if (/^canh\s/.test(f)) {
    const veg = curatedMatch(mention.replace(/^canh\s+/iu, ""), curated);
    if (veg) return { food: { id: veg.id, name: veg.name, displayName: `${String(veg.viName)} (tính phần rau của canh)`, per100g: per100(veg) }, match: "curated" };
  }
  try {
    const found = await fitnessAgentTools.searchFood(identity, mention);
    if (found) return { food: { id: found.id, name: found.name, displayName: found.name, per100g: per100(found) }, match: "search" };
  } catch { /* unmatched */ }
  return { food: null, match: "none" };
}

// ── 4. assemble ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function itemMacros(per100: { calories: number; protein: number; carbs: number; fat: number }, grams: number) {
  const k = grams / 100;
  return { calories: Math.round(per100.calories * k), protein: round1(per100.protein * k), carbs: round1(per100.carbs * k), fat: round1(per100.fat * k) };
}

export async function estimateDayMacros(identity: AgentIdentity, text: string): Promise<DayEstimate> {
  const extracted = await extractDayFoods(text, identity.userId);
  const curated = await curatedFoods(identity.userId);
  const items: DayEstimateItem[] = [];
  for (const e of extracted) {
    const { food, match } = await matchFood(identity, e.food, curated);
    const g = resolveGrams(e.food, e.quantity ?? null, e.unit ?? null);
    const macros = food ? itemMacros(food.per100g, g.grams) : { calories: 0, protein: 0, carbs: 0, fat: 0 };
    items.push({ mention: e.food, mealType: (e.meal ?? null) as MealType | null, food, grams: food ? g.grams : null, gramsSource: food ? g.source : null,
      unitNote: food ? g.note : null, match, ...macros });
  }
  const totals = items.reduce((t, i) => ({ calories: t.calories + i.calories, protein: round1(t.protein + i.protein), carbs: round1(t.carbs + i.carbs), fat: round1(t.fat + i.fat) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  let goal: DayEstimate["goal"] = null;
  try {
    const t = await fitnessAgentTools.getNutritionTargetPreview(identity);
    if (t.status === "ACTIVE_GOAL" || t.status === "COMPUTED") goal = { calories: t.calories, protein: t.protein, carbs: t.carbs, fat: t.fat, source: t.status };
  } catch { /* no goal */ }
  const notes = ["Số calo/macro lấy từ dữ liệu thực phẩm (USDA và danh mục món Việt chọn lọc) theo 100 g; khối lượng theo chén/tô/quả là ước tính — bạn sửa gram cho đúng phần mình ăn."];
  if (items.some((i) => i.match === "dish")) notes.push("Món ghép (phở, cơm chiên, chả giò…) dùng số liệu trung bình của USDA — cách nấu của bạn có thể khác.");
  return { items, totals, goal, unmatched: items.filter((i) => !i.food).map((i) => i.mention), notes };
}

const MEAL_VI: Record<string, string> = { breakfast: "Sáng", lunch: "Trưa", dinner: "Tối", snack: "Phụ" };
/** Chat answer (Vietnamese) for the same estimate the structured block carries. */
export function formatDayEstimate(e: DayEstimate): string {
  if (!e.items.length) return "Mình chưa thấy món nào trong đoạn bạn gửi. Bạn liệt kê giúp mình, ví dụ: \"sáng 1 tô phở bò, trưa 2 chén cơm + 150g ức gà, tối 1 quả chuối\".";
  const rows = e.items.map((i) => i.food
    ? `| ${i.mealType ? MEAL_VI[i.mealType] : "—"} | ${i.food.displayName} | ${i.grams} g${i.gramsSource !== "user" ? "*" : ""} | ${i.calories} | ${i.protein} | ${i.carbs} | ${i.fat} |`
    : `| ${i.mealType ? MEAL_VI[i.mealType] : "—"} | ${i.mention} — *không tìm thấy trong dữ liệu* | — | — | — | — | — |`);
  const t = e.totals, g = e.goal;
  const lines = [
    "Mình tính từ dữ liệu thực phẩm cho những món bạn kể:", "",
    "| Bữa | Món | Lượng | kcal | Đạm (g) | Carb (g) | Béo (g) |", "|---|---|---|---|---|---|---|", ...rows,
    `| | **Tổng** | | **${t.calories}** | **${t.protein}** | **${t.carbs}** | **${t.fat}** |`, "",
  ];
  if (g) {
    const d = (x: number, y: number) => (x - y >= 0 ? `dư ${round1(x - y)}` : `còn thiếu ${round1(y - x)}`);
    lines.push(`So với mục tiêu ${g.source === "ACTIVE_GOAL" ? "đang áp dụng" : "ước tính"} (${g.calories} kcal · đạm ${g.protein} g · carb ${g.carbs} g · béo ${g.fat} g): calo ${d(t.calories, g.calories)} kcal, đạm ${d(t.protein, g.protein)} g, carb ${d(t.carbs, g.carbs)} g, béo ${d(t.fat, g.fat)} g.`, "");
  }
  if (e.items.some((i) => i.food && i.gramsSource !== "user")) lines.push("\\* Khối lượng ước tính theo chén/tô/quả hoặc khẩu phần thông thường — sửa gram bên dưới nếu khác.");
  if (e.unmatched.length) lines.push(`Món chưa tìm thấy: ${e.unmatched.join(", ")} — bạn có thể tìm và thêm thủ công trong trang Dinh dưỡng.`);
  lines.push("Mình **chưa lưu** gì vào nhật ký — bấm \"Lưu vào nhật ký\" nếu bạn muốn ghi lại.");
  return lines.join("\n");
}

/** Chat trigger: an explicit ask to compute the day's/meal's macros from what was eaten. */
export function isDayMacroRequest(question: string): boolean {
  const q = fold(question);
  const compute = /\b(tinh|tong|dem|cong|xem|tinh giup|tinh dum)\b.{0,25}\b(macro|calo|kcal|dinh duong|protein|dam|nang luong)\b|\b(bao nhieu (calo|kcal|macro|protein))\b/.test(q);
  // (folded "toi" is both "tôi" and "tối", so only "tối nay" / "bữa tối" count as a meal word)
  const ate = /\b(an|uong|hom nay|ca ngay|sang|trua|chieu|toi nay|bua (sang|trua|toi|phu))\b/.test(q);
  const quantity = /\d|\b(mot|hai|ba|nua)\b/.test(q);
  const listed = quantity && (/[,+]|\bva\b/.test(q) || /\b(chen|bat|to|dia|qua|trai|o|lat|mieng|hop|ly|coc|g|gram|lang)\b/.test(q));
  return compute && ate && listed;
}
