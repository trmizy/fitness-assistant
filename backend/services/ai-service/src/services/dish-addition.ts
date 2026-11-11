/**
 * "Tôi muốn thêm bún bò vào thực đơn" — reviewer feedback (persona playground v2): the AI answered with its default sample menu. The user wants
 * to know how that dish fits: its real numbers (from the food library), its share of the daily target, and what to swap. Pure parsing/formatting;
 * the food lookup and the saved target are fetched by the agent service. Nothing is saved or changed.
 */
import { normalizeAgentText } from "./fitness-agent-intent";

const ACCENTED = /(?:thêm món|thêm|bổ sung|cho thêm|đưa|ghép)\s+(.{2,30}?)\s+vào\s+(?:thực đơn|bữa|menu|chế độ ăn)/iu;
const PLAIN = /(?:them mon|them|bo sung|cho them|dua|ghep)\s+(.{2,30}?)\s+vao\s+(?:thuc don|bua|menu|che do an)/;

export function parseDishToAdd(rawText: string): string | null {
  const t = rawText.trim().toLowerCase();
  if (t.split(/\s+/).length > 25) return null;
  const m = t.match(ACCENTED);
  if (m) return m[1].trim();
  const p = normalizeAgentText(rawText).match(PLAIN);
  return p ? p[1].trim() : null;
}

export interface FoodPer100 { name: string; calories: number; protein: number; carbs: number; fats: number }

// A bowl of noodle soup / rice porridge is a different amount than a piece of fruit.
export const defaultServingGrams = (name: string): number => (/\b(bun|pho|mi|hu tieu|banh canh|chao|sup|lau|com|xoi)\b/.test(normalizeAgentText(name)) ? 400 : 200);

export function buildDishAnalysis(food: FoodPer100, opts: { asked: string; dailyCalories?: number | null }): string {
  const g = defaultServingGrams(food.name);
  const k = (v: number) => Math.round((v * g) / 100);
  const kcal = k(food.calories);
  const share = opts.dailyCalories ? Math.round((kcal / opts.dailyCalories) * 100) : null;
  const rest = opts.dailyCalories ? Math.max(0, opts.dailyCalories - kcal) : null;
  const lines = [
    `**${food.name}** (theo thư viện thực phẩm: khoảng ${Math.round(food.calories)} kcal/100g). Một khẩu phần khoảng ${g}g ≈ **${kcal} kcal**, đạm ${k(food.protein)}g, carb ${k(food.carbs)}g, béo ${k(food.fats)}g (ước tính — tô/bát thực tế có thể khác).`,
  ];
  if (share !== null && opts.dailyCalories) lines.push(`Với mục tiêu ${opts.dailyCalories} kcal/ngày của bạn, món này chiếm khoảng **${share}%**${rest !== null ? `; còn khoảng ${rest} kcal cho các bữa còn lại` : ""}.`);
  lines.push(
    "",
    "**Cách đưa vào thực đơn:**",
    `1. Dùng ${opts.asked ? `“${opts.asked}”` : "món này"} **thay cho một bữa chính**, đừng cộng thêm vào bữa đã đủ — bỏ phần cơm/tinh bột của bữa đó.`,
    "2. Giữ đủ đạm trong ngày: bữa còn lại ưu tiên ức gà, cá, trứng, đậu hũ.",
    "3. Món nước/nhiều mỡ: chọn phần nạc, ăn nhiều rau, bớt nước béo để giảm calo mà vẫn no.",
    "",
    "Mình chưa thay đổi thực đơn đã lưu của bạn. Muốn tạo thực đơn mới? Nhắn “Tạo thực đơn cho tôi” — mình chỉ cho xem bản nháp, **chỉ lưu khi bạn xác nhận**.",
  );
  return lines.join("\n");
}

export const dishNotFoundAnswer = (asked: string) =>
  `Mình chưa tìm thấy món “${asked}” trong thư viện thực phẩm nên chưa dám đưa con số cụ thể. Bạn thử gõ tên khác (ví dụ “bún bò Huế”) hoặc nhắn “Tạo thực đơn cho tôi” để mình lập thực đơn theo mục tiêu của bạn — **chỉ lưu khi bạn xác nhận**.`;

// The food library is mostly generic/USDA names. A Vietnamese dish that is not in it can still be reasoned about HONESTLY through its base
// ingredient — but only that part is estimated, and the answer says so.
const BASE_INGREDIENT: { re: RegExp; term: string; label: string }[] = [
  { re: /\b(bun|hu tieu|banh canh|mi quang)\b/, term: "Rice noodles, cooked", label: "sợi bún/hủ tiếu (bún gạo, đã nấu)" },
  { re: /\b(pho)\b/, term: "Rice noodles, cooked", label: "bánh phở (bún gạo, đã nấu)" },
  { re: /\b(com)\b/, term: "Rice, white, cooked", label: "cơm trắng" },
  { re: /\b(banh mi)\b/, term: "Bread, white", label: "bánh mì" },
  { re: /\b(chao)\b/, term: "Rice, white, cooked", label: "gạo/cháo (ước tính theo cơm)" },
];
export function baseIngredientFor(dish: string): { term: string; label: string } | null {
  const s = normalizeAgentText(dish);
  const hit = BASE_INGREDIENT.find((b) => b.re.test(s));
  return hit ? { term: hit.term, label: hit.label } : null;
}

export function buildPartialDishAnalysis(base: FoodPer100, opts: { asked: string; label: string; dailyCalories?: number | null }): string {
  const g = 250; // a typical portion of the noodles/rice alone in a bowl
  const k = (v: number) => Math.round((v * g) / 100);
  const kcal = k(base.calories);
  const share = opts.dailyCalories ? Math.round((kcal / opts.dailyCalories) * 100) : null;
  return [
    `Món “${opts.asked}” chưa có sẵn trong thư viện thực phẩm, nên mình **không đưa con số cho cả tô**. Mình chỉ ước tính được phần **${opts.label}**: khoảng ${g}g ≈ **${kcal} kcal**, đạm ${k(base.protein)}g, carb ${k(base.carbs)}g, béo ${k(base.fats)}g${share !== null && opts.dailyCalories ? ` (≈ ${share}% mục tiêu ${opts.dailyCalories} kcal/ngày)` : ""}.`,
    "Thịt, xương và nước dùng sẽ cộng thêm calo và béo, tùy loại và lượng — chọn phần nạc và bớt nước béo để nhẹ hơn.",
    "",
    "**Cách đưa vào thực đơn:** dùng món này **thay cho một bữa chính** (đừng cộng thêm vào bữa đã đủ); các bữa còn lại giữ đủ đạm (ức gà, cá, trứng, đậu hũ) và nhiều rau.",
    "",
    "Mình chưa thay đổi thực đơn đã lưu của bạn. Muốn tạo thực đơn mới? Nhắn “Tạo thực đơn cho tôi” — mình chỉ cho xem bản nháp, **chỉ lưu khi bạn xác nhận**.",
  ].join("\n");
}
