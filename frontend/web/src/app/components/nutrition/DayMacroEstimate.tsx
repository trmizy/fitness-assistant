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

/** Nutrition page box: describe what you ate in plain words → the editable estimate above (self-contained state). */
export function DayMacroQuickEstimate({ dateStr }: { dateStr?: string }) {
  const [open, setOpen] = useState(false);
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
  return <section className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-3">
    <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center justify-between text-left" aria-expanded={open}>
      <span className="text-sm font-semibold text-zinc-100">Tính nhanh macro từ mô tả</span>
      <span className="text-xs text-zinc-500">{open ? "Thu gọn" : "Mở"}</span>
    </button>
    {open && <div className="mt-2 space-y-2">
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500}
        placeholder="Ví dụ: sáng 1 tô phở bò, trưa 2 chén cơm + 150g ức gà + 1 bát canh cải, tối 1 quả chuối và 1 hộp sữa chua"
        className="w-full resize-none rounded-lg border border-zinc-700/60 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-orange-500/50" />
      <button type="button" disabled={loading || text.trim().length < 3} onClick={() => void run()}
        className="min-h-11 rounded-lg bg-orange-500 px-4 text-sm font-bold text-black hover:bg-orange-400 disabled:opacity-50">{loading ? "Đang tính…" : "Tính macro"}</button>
      {result && <DayMacroEstimate key={JSON.stringify(result.items.map((i) => i.mention))} estimate={result} dateStr={dateStr} />}
    </div>}
  </section>;
}

const MEALS: Array<[MealType, string]> =[["breakfast", "Sáng"], ["lunch", "Trưa"], ["dinner", "Tối"], ["snack", "Phụ"]];
const MATCH_NOTE: Record<string, string> = { dish: "món ghép — số liệu trung bình USDA", search: "khớp gần đúng theo tên" };
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
  const bar = (label: string, v: number, target: number | undefined, unit: string) => {
    const pct = target ? Math.min(100, Math.round((v / target) * 100)) : 0;
    const diff = target ? r1(v - target) : null;
    return <div key={label} className="space-y-1">
      <div className="flex justify-between text-xs"><span className="text-zinc-400">{label}</span>
        <span className="text-zinc-200">{v}{unit}{target ? <span className="text-zinc-500"> / {target}{unit} · {diff! >= 0 ? `dư ${diff}` : `thiếu ${-diff!}`}</span> : null}</span></div>
      {target ? <div className="h-1.5 rounded-full bg-zinc-800"><div className={`h-1.5 rounded-full ${diff! > target * 0.1 ? "bg-amber-400" : "bg-orange-500"}`} style={{ width: `${pct}%` }} /></div> : null}
    </div>;
  };

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
    {estimate.unmatched.length > 0 && <p className="text-xs text-zinc-400">Chưa tìm thấy trong dữ liệu: {estimate.unmatched.join(", ")} — có thể thêm thủ công bằng “Thêm món ăn”.</p>}
    <div className="space-y-2 rounded-lg border border-zinc-800 p-2">
      <p className="text-xs font-semibold text-zinc-300">Tổng {goal ? `so với mục tiêu ${goal.source === "ACTIVE_GOAL" ? "đang áp dụng" : "ước tính"}` : ""}</p>
      {bar("Calo", totals.calories, goal?.calories, " kcal")}
      {bar("Đạm", totals.protein, goal?.protein, " g")}
      {bar("Carb", totals.carbs, goal?.carbs, " g")}
      {bar("Béo", totals.fat, goal?.fat, " g")}
    </div>
    {estimate.notes.map((n, i) => <p key={i} className="text-xs text-zinc-500">{n}</p>)}
    <button type="button" disabled={saving || saved || kept.length === 0} onClick={() => void save()}
      className="min-h-11 w-full rounded-lg bg-orange-500 px-3 text-sm font-bold text-black hover:bg-orange-400 disabled:opacity-50">
      {saved ? "Đã lưu vào nhật ký" : saving ? "Đang lưu…" : `Lưu ${kept.length} món vào nhật ký`}</button>
  </div>;
}
