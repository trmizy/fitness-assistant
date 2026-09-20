/**
 * Structured, ENFORCEABLE food exclusions for AI nutrition generation
 * (AI Coach product remediation M1/M2). A free-text restriction forwarded
 * only into an LLM prompt is a request, not an enforcement — the processor's
 * deterministic food pools never saw it and re-added the excluded food
 * (Codex product E2E #1, M2: 28 salmon items for "không ăn cá").
 *
 * The food catalog (USDA-derived `Food` rows) has no category column, so the
 * only real signal available is the food NAME. This module is therefore a
 * deliberately small, bounded ontology: user phrase -> canonical key ->
 * name tokens. A phrase that cannot be resolved is reported as UNSUPPORTED
 * so the caller can ask/refuse instead of pretending it is enforced.
 * User-declared exclusion enforcement only — never a diagnosis or an
 * allergy-safety guarantee (see docs/ai-coach-product-remediation-1.md).
 */

const FISH = ["fish", "salmon", "tuna", "cod", "tilapia", "trout", "sardine", "sardines", "mackerel", "anchovy", "anchovies", "herring", "catfish", "halibut", "bass", "snapper", "haddock", "pollock", "mahi", "swordfish", "perch", "carp", "eel", "flounder", "sole", "grouper", "mullet", "pike", "roe", "caviar", "cá"];
const SHELLFISH = ["shrimp", "prawn", "prawns", "crab", "lobster", "crayfish", "crawfish", "clam", "clams", "oyster", "oysters", "mussel", "mussels", "scallop", "scallops", "squid", "octopus", "abalone", "cuttlefish", "tôm", "cua", "mực"];
const DAIRY = ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "whey", "casein", "kefir", "dairy", "ghee", "custard", "sữa"];

type Entry = { key: string; label: string; tokens: string[]; aliases: string[] };

// aliases: normalized (diacritic-stripped, lowercase) user phrases.
const ENTRIES: Entry[] = [
  { key: "fish", label: "cá", tokens: FISH, aliases: ["ca", "cac loai ca", "hai san co vay"] },
  { key: "shellfish", label: "tôm/cua/sò (giáp xác, nhuyễn thể)", tokens: SHELLFISH, aliases: ["tom", "cua", "so", "muc", "tom cua", "giap xac", "nhuyen the"] },
  { key: "seafood", label: "hải sản", tokens: [...FISH, ...SHELLFISH], aliases: ["hai san", "do bien", "seafood"] },
  { key: "peanut", label: "đậu phộng/lạc", tokens: ["peanut", "peanuts", "groundnut", "groundnuts", "lạc"], aliases: ["dau phong", "lac", "dau phong rang", "peanut", "peanuts"] },
  { key: "treenut", label: "các loại hạt", tokens: ["almond", "almonds", "walnut", "walnuts", "cashew", "cashews", "pistachio", "pistachios", "hazelnut", "hazelnuts", "pecan", "pecans", "macadamia", "nut", "nuts"], aliases: ["hat", "cac loai hat", "hat cay", "nuts"] },
  { key: "beef", label: "thịt bò", tokens: ["beef", "veal", "steak", "brisket", "bò"], aliases: ["thit bo", "bo", "beef"] },
  { key: "pork", label: "thịt heo", tokens: ["pork", "bacon", "ham", "sausage", "lard", "heo", "lợn"], aliases: ["thit heo", "thit lon", "heo", "lon", "pork"] },
  { key: "chicken", label: "thịt gà", tokens: ["chicken", "gà"], aliases: ["thit ga", "ga", "chicken"] },
  { key: "egg", label: "trứng", tokens: ["egg", "eggs", "trứng"], aliases: ["trung", "egg", "eggs"] },
  { key: "dairy", label: "sữa và chế phẩm từ sữa", tokens: DAIRY, aliases: ["sua", "sua bo", "che pham tu sua", "dairy", "pho mai", "lactose"] },
  { key: "soy", label: "đậu nành", tokens: ["soy", "soya", "soybean", "soybeans", "tofu", "tempeh", "edamame", "miso"], aliases: ["dau nanh", "dau hu", "soy", "dau phu"] },
  { key: "gluten", label: "gluten (lúa mì/lúa mạch/lúa mạch đen)", tokens: ["wheat", "barley", "rye", "flour", "bread", "pasta", "noodle", "noodles", "couscous", "semolina", "bulgur"], aliases: ["gluten", "lua mi", "bot mi", "banh mi"] },
];

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export type ResolvedRestriction = { key: string; label: string; phrase: string };

export type RestrictionResolution =
  | { supported: true; resolved: ResolvedRestriction }
  | { supported: false; phrase: string };

/** Resolves ONE restriction phrase such as "không ăn cá" / "dị ứng đậu phộng". */
export function resolveFoodRestriction(phrase: string): RestrictionResolution {
  const stripped = normalizeForMatch(phrase)
    .replace(/^(khong an|khong dung|khong uong|di ung|tranh|kieng|no|avoid)\s+/, "")
    .trim();
  for (const entry of ENTRIES) {
    if (entry.aliases.includes(stripped)) {
      return { supported: true, resolved: { key: entry.key, label: entry.label, phrase: phrase.trim() } };
    }
  }
  return { supported: false, phrase: phrase.trim() };
}

function tokensForKeys(keys: string[]): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    const entry = ENTRIES.find((e) => e.key === key);
    if (entry) entry.tokens.forEach((t) => out.add(t.normalize("NFC").toLowerCase()));
  }
  return [...out];
}

function foodNameTokens(name: string): string[] {
  return name.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when the food NAME contains any excluded token (whole-token match,
 * so "egg" never matches "eggplant"; plural -s/-es tolerated). */
export function foodViolatesExclusions(foodName: string, excludedKeys: string[]): boolean {
  if (!excludedKeys.length) return false;
  const excluded = new Set(tokensForKeys(excludedKeys));
  return foodNameTokens(foodName).some((tok) => excluded.has(tok) || excluded.has(tok.replace(/(es|s)$/, "")));
}

export function filterFoodsByExclusions<T extends { name: string }>(foods: T[], excludedKeys: string[]): T[] {
  return excludedKeys.length ? foods.filter((f) => !foodViolatesExclusions(f.name, excludedKeys)) : foods;
}

/** Final gate over a fully expanded plan — every selected item, by name. */
export function findExclusionViolations(
  content: { weeklySchedule: Array<{ meals: Array<{ items: Array<{ name: string }> }> }> },
  excludedKeys: string[],
): string[] {
  const hits = new Set<string>();
  if (!excludedKeys.length) return [];
  for (const day of content.weeklySchedule) {
    for (const meal of day.meals) {
      for (const item of meal.items) {
        if (foodViolatesExclusions(item.name, excludedKeys)) hits.add(item.name);
      }
    }
  }
  return [...hits];
}

export function isKnownExclusionKey(key: string): boolean {
  return ENTRIES.some((e) => e.key === key);
}

export const SUPPORTED_RESTRICTION_LABELS = ENTRIES.filter((e) => e.key !== "shellfish" && e.key !== "treenut").map((e) => e.label);

// ── Chat-side extraction (workflow-local, never persisted to profile/memory) ──

export type NutritionConstraintSet = {
  /** ENFORCED — canonical exclusions, deduped by key (never rolled off). */
  exclusions: ResolvedRestriction[];
  /** Phrases the user asked to exclude that this module cannot enforce. */
  unsupported: string[];
  /** Soft, prompt-only preferences (budget/cuisine/"đổi bữa"). Best-effort. */
  hints: string[];
};

export const EMPTY_CONSTRAINTS: NutritionConstraintSet = { exclusions: [], unsupported: [], hints: [] };
/** Only the most recent soft hints are kept; enforced exclusions never roll off. */
export const MAX_NUTRITION_HINTS = 10;

const CUE_RE = /(không ăn|không dùng|không uống|dị ứng|kiêng|tránh)\s+([^.!?\n]+)/giu;
// First words of clauses that are preferences/quantities, not food names.
const NON_FOOD_STARTERS = new Set(["ưu", "tiết", "muốn", "thêm", "hãy", "ít", "nhiều", "giảm", "dễ", "cho", "tôi", "mình", "đổi", "giúp", "món", "chia", "làm", "tạo", "và", "cũng", "nhớ", "lưu"]);
const STOP_TOKENS = new Set(["đổi", "giúp", "nhé", "nha", "với", "thay", "làm", "cho", "tôi", "mình", "dùm", "được", "nhưng", "mà", "rồi", "thì", "và", "hoặc", "cũng"]);

export function extractNutritionConstraints(message: string): NutritionConstraintSet {
  const set: NutritionConstraintSet = { exclusions: [], unsupported: [], hints: [] };
  const text = message.trim();
  if (!text) return set;
  const seen = new Set<string>();
  for (const m of text.matchAll(CUE_RE)) {
    const cue = m[1];
    // "cá, tôm" / "cá và tôm": comma/và/hoặc separate items; a stop word ends the item.
    const items = m[2].split(/\s*(?:,|;|\/|\svà\s|\shoặc\s)\s*/iu);
    for (const item of items) {
      // Every clause is processed independently (final remediation M2): the old
      // `idx === 0` rule silently dropped an unsupported LATER exclusion.
      const own = item.trim().match(/^(không ăn|không dùng|không uống|dị ứng|kiêng|tránh)\s+(.*)$/iu);
      const itemCue = (own ? own[1] : cue).toLowerCase();
      const bare = own ? own[2] : item.trim();
      const tokens = bare.split(/\s+/).filter(Boolean);
      // A clause that is not a food exclusion ("4 bữa", "ưu tiên món Việt", "giảm ngân sách") is
      // never counted as an unsupported hard exclusion — unless it repeats an explicit cue.
      if (!own && (tokens.length === 0 || /^\d/.test(tokens[0]) || NON_FOOD_STARTERS.has(tokens[0].toLowerCase()) || tokens.some((t) => t.toLowerCase() === "bữa"))) continue;
      const words: string[] = [];
      for (const tok of tokens) {
        if (STOP_TOKENS.has(tok.toLowerCase())) break;
        words.push(tok);
      }
      const phrase = words.join(" ").trim();
      if (!phrase) continue;
      const resolution = resolveFoodRestriction(`${itemCue} ${phrase}`);
      if (resolution.supported) {
        if (!seen.has(resolution.resolved.key)) { seen.add(resolution.resolved.key); set.exclusions.push(resolution.resolved); }
      } else {
        const label = `${itemCue} ${phrase}`.trim();
        if (!set.unsupported.includes(label)) set.unsupported.push(label);
      }
    }
  }
  if (/giảm ngân sách|ngân sách thấp|rẻ hơn|tiết kiệm hơn/i.test(text)) set.hints.push("Ưu tiên thực phẩm rẻ, dễ mua, tiết kiệm chi phí hơn thực đơn trước");
  if (/món việt|đồ việt/i.test(text)) set.hints.push("Ưu tiên món ăn Việt Nam quen thuộc");
  if (/dễ mua|dễ tìm/i.test(text)) set.hints.push("Ưu tiên thực phẩm dễ mua, phổ biến ở Việt Nam");
  if (/đổi bữa sáng/i.test(text)) set.hints.push("Đổi các món bữa sáng khác với thực đơn trước, không lặp lại y hệt");
  if (/đổi bữa trưa/i.test(text)) set.hints.push("Đổi các món bữa trưa khác với thực đơn trước, không lặp lại y hệt");
  if (/đổi bữa tối/i.test(text)) set.hints.push("Đổi các món bữa tối khác với thực đơn trước, không lặp lại y hệt");
  if (/đổi món|món khác/i.test(text)) set.hints.push("Đổi một số món ăn khác với thực đơn trước, không lặp lại y hệt");
  return set;
}

export const constraintSetIsEmpty = (c: NutritionConstraintSet) => !c.exclusions.length && !c.unsupported.length && !c.hints.length;

/** Merge, never replace: exclusions dedupe by key, hints dedupe by text (newest kept if capped). */
export function mergeNutritionConstraints(a: NutritionConstraintSet | undefined, b: NutritionConstraintSet | undefined): NutritionConstraintSet {
  const exclusions = new Map<string, ResolvedRestriction>();
  for (const e of [...(a?.exclusions ?? []), ...(b?.exclusions ?? [])]) if (!exclusions.has(e.key)) exclusions.set(e.key, e);
  const hints = [...new Set([...(a?.hints ?? []), ...(b?.hints ?? [])])].slice(-MAX_NUTRITION_HINTS);
  return { exclusions: [...exclusions.values()], unsupported: [...new Set([...(a?.unsupported ?? []), ...(b?.unsupported ?? [])])], hints };
}

/** Free-text lines for the LLM prompt (in addition to the enforced filter). */
export function constraintPromptLines(c: NutritionConstraintSet): string[] {
  return [...c.exclusions.map((e) => e.phrase), ...c.hints];
}

export function unsupportedRestrictionMessage(unsupported: string[]): string {
  return `Mình chưa thể ĐẢM BẢO loại trừ được: ${unsupported.map((u) => `"${u}"`).join(", ")} — thư viện thực phẩm chỉ cho phép mình lọc chắc chắn theo các nhóm: ${SUPPORTED_RESTRICTION_LABELS.join(", ")}. Bạn nói lại theo các nhóm này (hoặc bỏ yêu cầu đó) nhé — mình không muốn hứa loại trừ mà không làm được.`;
}
