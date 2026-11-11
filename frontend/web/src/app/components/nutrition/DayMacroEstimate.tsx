/**
 * "Tính macro cả ngày" result (POST /ai/nutrition/day-estimate) — shared by the AI chat block (NUTRITION_DAY_ESTIMATE) and the
 * Nutrition page's quick-estimate box. Every number scales from the matched food's per-100 g values; grams are editable
 * because unit-based amounts (chén/tô/quả) are estimates. Nothing is saved until the user presses "Lưu vào nhật ký", which
 * uses the existing POST /nutrition (same payload as the page's "Thêm món ăn").
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "../../services/api";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export interface DayEstimateItem {
  mention: string;
  mealType: MealType | null;
  food: { id: string; name: string; displayName: string; per100g: { calories: number; protein: number; carbs: number; fat: number } } | null;
  grams: number | null;
  gramsSource: "user" | "unit_estimate" | "default_portion" | null;
  unitNote: string | null;
  match: "curated" | "dish" | "search" | "none";
}
export interface DayEstimate {
  items: DayEstimateItem[];
  goal: { calories: number; protein: number; carbs: number; fat: number; source: "ACTIVE_GOAL" | "COMPUTED" } | null;
  unmatched: string[];
  notes: string[];
}

export async function estimateDayMacros(text: string): Promise<DayEstimate> {
  const { data } = await api.post("/ai/nutrition/day-estimate", { text });
  return data?.data as DayEstimate;
}

const EXAMPLES = [
  "sáng 1 tô phở bò, trưa 2 chén cơm + 150g ức gà + canh cải",
  "sáng 2 quả trứng luộc và 1 ổ bánh mì, tối 1 đĩa cơm tấm",
  "trưa 1 tô bún bò, chiều 1 hộp sữa chua, tối 200g cá hồi",
];

/** How the numbers are produced — shown to the user (2026-11-09: "không biết đang dùng AI hay thuật toán"). */
export function DayMacroMethodNote() {
  return <p className="text-[11px] leading-relaxed text-zinc-500">
    <span className="font-semibold text-zinc-400">Cách tính:</span> AI chỉ tách món, số lượng và bữa từ câu bạn viết. Calo và macro
    lấy từ dữ liệu thực phẩm (danh mục món Việt + USDA) nhân theo số gram — không do AI tự đoán. Lượng theo chén/tô/quả là ước tính,
    bạn sửa được trước khi lưu.
  </p>;
}

/**
 * "Hôm nay bạn đã ăn gì?" — the prominent quick-estimate card (Nutrition page, and the Dashboard in its compact form).
 * Describe what you ate in plain words → the editable estimate below (self-contained state; nothing saved until confirmed).
 */
export function DayMacroQuickEstimate({ dateStr, variant = "page" }: { dateStr?: string; variant?: "page" | "compact" }) {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DayEstimate | null>(null);
  async function run() {
    setLoading(true);
    setResult(null);
    try {
      setResult(await estimateDayMacros(text.trim()));
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message ?? "Chưa tính được lúc này, bạn thử lại sau ít phút.");
    } finally {
      setLoading(false);
    }
  }
  const compact = variant === "compact";
  return <section data-testid="day-macro-quick-estimate"
    className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-500/10 via-zinc-900/60 to-zinc-900/40 p-4 shadow-lg shadow-orange-500/5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={`font-bold text-zinc-100 ${compact ? "text-base" : "text-lg"}`}>🍽️ Hôm nay bạn đã ăn gì?</h2>
        <p className="mt-0.5 text-xs text-zinc-400">Gõ như đang kể chuyện — mình tính calo, đạm, tinh bột, chất béo và so với mục tiêu của bạn.</p>
      </div>
      {!compact && <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="min-h-9 shrink-0 rounded-md px-2 text-xs text-zinc-500 hover:text-zinc-300">{open ? "Thu gọn" : "Mở"}</button>}
    </div>
    {open && <div className="mt-3 space-y-2.5">
      <textarea rows={compact ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500}
        placeholder="Ví dụ: sáng 1 tô phở bò, trưa 2 chén cơm + 150g ức gà + 1 bát canh cải, tối 1 quả chuối và 1 hộp sữa chua"
        className="w-full resize-none rounded-xl border border-zinc-700/60 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-orange-500/60" />
      {!text && <div className="flex flex-wrap gap-1.5" aria-label="Câu mẫu">
        {EXAMPLES.slice(0, compact ? 2 : 3).map((ex) => <button key={ex} type="button" onClick={() => setText(ex)}
          className="min-h-9 max-w-full truncate rounded-full border border-zinc-700 px-3 text-xs text-zinc-400 hover:border-orange-500/50 hover:text-zinc-200">{ex}</button>)}
      </div>}
      <button type="button" disabled={loading || text.trim().length < 3} onClick={() => void run()}
        className="min-h-11 w-full rounded-xl bg-orange-500 px-4 text-sm font-bold text-black hover:bg-orange-400 disabled:opacity-50 sm:w-auto">{loading ? "Đang tính…" : "Tính macro"}</button>
      {result && <DayMacroEstimate key={JSON.stringify(result.items.map((i) => i.mention))} estimate={result} dateStr={dateStr} />}
      <DayMacroMethodNote />
    </div>}
  </section>;
}

const MEALS: Array<[MealType, string]> =[["breakfast", "Sáng"], ["lunch", "Trưa"], ["dinner", "Tối"], ["snack", "Phụ"]];
const MATCH_NOTE: Record<string, string> = { dish: "món ghép — số liệu trung bình USDA", curated: "danh mục món Việt — số liệu USDA", search: "khớp theo tên, số liệu lấy từ USDA" };
const r1 = (x: number) => Math.round(x * 10) / 10;
const todayVN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

export function DayMacroEstimate({ estimate, dateStr }: { estimate: DayEstimate; dateStr?: string }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => estimate.items.filter((i) => i.food).map((i, k) => ({ key: k, item: i, grams: String(i.grams ?? 100), meal: (i.mealType ?? "snack") as MealType, keep: true })));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const computed = useMemo(() => rows.map((r) => {
    const g = Math.max(0, Number(r.grams) || 0), p = r.item.food!.per100g, k = g / 100;
    return { ...r, g, calories: Math.round(p.calories * k), protein: r1(p.protein * k), carbs: r1(p.carbs * k), fat: r1(p.fat * k) };
  }), [rows]);
  const kept = computed.filter((r) => r.keep && r.g > 0);
  const totals = kept.reduce((t, r) => ({ calories: t.calories + r.calories, protein: r1(t.protein + r.protein), carbs: r1(t.carbs + r.carbs), fat: r1(t.fat + r.fat) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  async function save() {
    setSaving(true);
    const date = new Date((dateStr ?? todayVN()) + "T12:00:00.000Z").toISOString();
    let ok = 0;
    try {
      for (const r of kept) {
        await api.post("/nutrition", { date, mealType: r.meal, foodId: r.item.food!.id, foodName: r.item.food!.displayName, quantity: r.g, unit: "g",
          calories: r.calories, protein: r.protein, carbs: r.carbs, fats: r.fat });
        ok++;
      }
      setSaved(true);
      toast.success(`Đã lưu ${ok} món vào nhật ký`);
    } catch {
      toast.error(ok ? `Đã lưu ${ok}/${kept.length} món — phần còn lại chưa lưu được` : "Không lưu được vào nhật ký");
    } finally {
      for (const key of [["nutrition-logs"], ["nutrition-weekly"], ["nutrition-daily-task"], ["nutrition-monthly-summary"]]) queryClient.invalidateQueries({ queryKey: key });
      setSaving(false);
    }
  }

  const goal = estimate.goal;

  return <div className="space-y-3 rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-3 text-sm">
    {computed.length === 0 && <p className="text-zinc-300">Chưa tìm được món nào trong dữ liệu để tính.</p>}
    {computed.length > 0 && <ul className="space-y-2">
      {computed.map((r) => <li key={r.key} className={`rounded-lg border border-zinc-800 p-2 ${r.keep ? "" : "opacity-50"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-zinc-100 break-words">{r.item.food!.displayName}</p>
            {MATCH_NOTE[r.item.match] && <p className="text-xs text-zinc-500">{MATCH_NOTE[r.item.match]}{r.item.match === "search" ? `: ${r.item.food!.name}` : ""}</p>}
            {r.item.unitNote && <p className="text-xs text-amber-300/90">{r.item.unitNote}</p>}
          </div>
          <button type="button" className="min-h-9 rounded-md border border-zinc-700 px-2 text-xs text-zinc-400 hover:text-zinc-200" aria-label={r.keep ? "Bỏ món này" : "Thêm lại món này"}
            onClick={() => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, keep: !x.keep } : x)))}>{r.keep ? "Bỏ" : "Thêm lại"}</button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select aria-label="Bữa" value={r.meal} disabled={saved} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, meal: e.target.value as MealType } : x)))}
            className="min-h-9 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200">{MEALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label className="flex items-center gap-1 text-xs text-zinc-400"><input type="number" min={0} max={5000} inputMode="decimal" value={r.grams} disabled={saved} aria-label="Khối lượng (g)"
            onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, grams: e.target.value } : x)))}
            className="min-h-9 w-20 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-zinc-100" /> g</label>
          <span className="text-xs text-zinc-300">{r.calories} kcal · Đ {r.protein} · C {r.carbs} · B {r.fat}</span>
        </div>
      </li>)}
    </ul>}
    {estimate.unmatched.length > 0 && <p className="text-xs text-zinc-400">Chưa có số liệu cho: <span className="text-zinc-200">{estimate.unmatched.join(", ")}</span>. Món ghép nhiều thành phần (cơm tấm, bún bò…) bạn ghi rõ từng phần — ví dụ “cơm 200g, sườn nướng 100g” — để tính chính xác, hoặc thêm thủ công bằng “Thêm món ăn”.</p>}
    <div className="space-y-2 rounded-xl border border-zinc-800 p-3">
      <p className="text-xs font-semibold text-zinc-300">Tổng hôm nay {goal ? `so với mục tiêu ${goal.source === "ACTIVE_GOAL" ? "đang áp dụng" : "ước tính"}` : ""}</p>
      <MacroRings totals={totals} goal={goal} />
    </div>
    {estimate.notes.map((n, i) => <p key={i} className="text-xs text-zinc-500">{n}</p>)}
    <button type="button" disabled={saving || saved || kept.length === 0} onClick={() => void save()}
      className="min-h-11 w-full rounded-lg bg-orange-500 px-3 text-sm font-bold text-black hover:bg-orange-400 disabled:opacity-50">
      {saved ? "Đã lưu vào nhật ký" : saving ? "Đang lưu…" : `Lưu ${kept.length} món vào nhật ký`}</button>
  </div>;
}

/** Four progress rings (eaten vs goal) — the colours are the macro colours of the Nutrition goal modal. */
const RINGS: Array<{ key: "calories" | "protein" | "carbs" | "fat"; label: string; unit: string; stroke: string; text: string }> = [
  { key: "calories", label: "Calo", unit: "kcal", stroke: "stroke-orange-400", text: "text-orange-400" },
  { key: "protein", label: "Đạm", unit: "g", stroke: "stroke-green-400", text: "text-green-400" },
  { key: "carbs", label: "Tinh bột", unit: "g", stroke: "stroke-blue-400", text: "text-blue-400" },
  { key: "fat", label: "Chất béo", unit: "g", stroke: "stroke-amber-400", text: "text-amber-400" },
];

export function MacroRings({ totals, goal }: { totals: { calories: number; protein: number; carbs: number; fat: number }; goal: DayEstimate["goal"] }) {
  const R = 30, C = 2 * Math.PI * R;
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="macro-rings">
    {RINGS.map((ring) => {
      const value = totals[ring.key], target = goal ? goal[ring.key] : 0;
      const ratio = target ? value / target : 0;
      const over = target > 0 && ratio > 1.1;
      const diff = target ? Math.round((value - target) * 10) / 10 : null;
      return <div key={ring.key} className="flex flex-col items-center text-center">
        <div className="relative h-[84px] w-[84px]">
          <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="36" cy="36" r={R} fill="none" strokeWidth="7" className="stroke-zinc-800" />
            {target > 0 && <circle cx="36" cy="36" r={R} fill="none" strokeWidth="7" strokeLinecap="round"
              className={`${over ? "stroke-red-400" : ring.stroke} transition-[stroke-dashoffset] duration-700`}
              strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, ratio))} />}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-base font-bold leading-none ${ring.text}`}>{ring.key === "calories" ? Math.round(value) : value}</span>
            <span className="mt-0.5 text-[10px] text-zinc-500">{target ? `/ ${Math.round(target)}` : ring.unit}</span>
          </div>
        </div>
        <span className="mt-1 text-xs font-semibold text-zinc-300">{ring.label}{target ? ` (${ring.unit})` : ""}</span>
        {diff !== null && <span className={`text-[11px] ${over ? "text-red-400" : diff >= 0 ? "text-zinc-400" : "text-zinc-500"}`}>
          {diff >= 0 ? `dư ${diff}` : `còn ${-diff}`}</span>}
      </div>;
    })}
  </div>;
}
