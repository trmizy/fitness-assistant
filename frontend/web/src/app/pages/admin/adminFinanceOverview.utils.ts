/**
 * B3 — phần thuần của "Tài chính › Tổng quan" (chạy dưới `npx tsx --test`, không React).
 *
 * Quy ước tiền (Master Plan §3): JSON là chuỗi Decimal ("100000", "100000.5", "100000.00"). MỘT hàm đọc duy nhất
 * (`parseCents` → bigint "xu" = đồng × 100, không làm tròn trung gian) và MỘT hàm làm tròn khi hiển thị
 * (`centsToDong`, nửa lên xa số 0). Không `Number()` trên tiền, không cộng số thực. Không đọc được → `null`,
 * UI hiện "—", KHÔNG BAO GIỜ 0.
 */

// ───────────────────────────────────────────────────────────────── tiền ──
const MONEY_RE = /^-?\d+(\.\d+)?$/;

/** Chuỗi Decimal (hoặc số hữu hạn) → bigint xu. `null` nếu thiếu / sai định dạng. */
export function parseCents(value: unknown): bigint | null {
  let text: string;
  if (typeof value === "string") text = value.trim();
  else if (typeof value === "number" && Number.isFinite(value)) text = value.toFixed(2);
  else return null;
  if (!MONEY_RE.test(text)) return null;
  const negative = text.startsWith("-");
  const [intPart, fracRaw = ""] = (negative ? text.slice(1) : text).split(".");
  // Lấy tối đa 2 chữ số thập phân; phần dư (hiếm: backend toFixed(2) hoặc cột 2dp) làm tròn nửa lên.
  const frac = (fracRaw + "00").slice(0, 2);
  let cents = BigInt(intPart) * 100n + BigInt(frac);
  if (fracRaw.length > 2 && fracRaw.charCodeAt(2) >= 53 /* '5' */) cents += 1n;
  return negative ? -cents : cents;
}

/** xu → đồng nguyên, nửa lên xa số 0 (-0,5 → -1). */
export function centsToDong(cents: bigint): bigint {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dong = (abs + 50n) / 100n;
  return negative ? -dong : dong;
}

/** Chuỗi Decimal → đồng nguyên (bigint), hoặc `null`. */
export function parseMoney(value: unknown): bigint | null {
  const cents = parseCents(value);
  return cents === null ? null : centsToDong(cents);
}

const VND = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

/** "590.800.000 ₫"; `null` → "—" (không bao giờ "0 ₫" cho dữ liệu chưa có). */
export function formatDong(dong: bigint | null | undefined): string {
  if (dong === null || dong === undefined) return "—";
  return VND.format(dong);
}

const VND_EXACT = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Chênh lệch sổ: đồng nguyên như mọi số tiền, nhưng nếu lệch DƯỚI 1 đồng (≠ 0) thì hiện đủ số lẻ — để một sổ lệch
 * không bao giờ hiện "0 ₫" cạnh chip "Lệch sổ". (Chỉ để hiển thị.)
 */
export function formatDriftCents(cents: bigint): string {
  if (cents % 100n === 0n || centsToDong(cents) !== 0n) return formatDong(centsToDong(cents));
  return VND_EXACT.format(Number(cents) / 100);
}

/**
 * Chuỗi Decimal → số tiền ĐÚNG như server trả, KHÔNG làm tròn: "300.000 ₫" khi tròn đồng, "299.999,84 ₫" khi có phần lẻ; "—" khi không đọc được.
 * Dùng cho mọi số tiền thật của một hồ sơ (báo giá hoàn, số đã ghi vào ví, số còn thiếu) — backend 09/11: frontend không tự làm tròn.
 */
export function formatMoneyExact(value: unknown): string {
  const cents = parseCents(value);
  if (cents === null) return "—";
  if (cents % 100n === 0n) return formatDong(cents / 100n);
  return VND_CENTS.format(Number(cents) / 100);
}
const VND_CENTS = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Chuỗi Decimal → "590.800.000 ₫" hoặc "—". */
export function formatMoneyString(value: unknown): string {
  return formatDong(parseMoney(value));
}

/** Cộng các số xu; `null` nếu bất kỳ phần tử nào không đọc được (không cộng thiếu rồi gọi là tổng). */
export function sumCents(values: unknown[]): bigint | null {
  let total = 0n;
  for (const v of values) {
    const c = parseCents(v);
    if (c === null) return null;
    total += c;
  }
  return total;
}

/** Tỷ lệ phần trăm theo điểm cơ bản (1/10000) của `part` trên `total` (xu). `null` nếu total ≤ 0 hoặc thiếu. */
export function shareBp(part: bigint | null, total: bigint | null): number | null {
  if (part === null || total === null || total <= 0n) return null;
  const bp = (part * 10000n * 2n + total) / (total * 2n); // làm tròn nửa lên
  return Number(bp);
}

/** 3120 → "31,2%". `null` → "—". */
export function formatShare(bp: number | null): string {
  if (bp === null) return "—";
  const tenths = Math.round(bp / 10);
  return `${Math.floor(tenths / 10)},${tenths % 10}%`;
}

// ───────────────────────────────────────────────── P3 — đối soát hiện tại ──
export const BREAKDOWN_KEYS = [
  "clientBalances",
  "ptPending",
  "ptAvailable",
  "ptLocked",
  "ptHoldback",
  "gymPending",
  "gymAvailable",
  "gymLocked",
  "platformRevenuePending",
  "platformRevenueAvailable",
] as const;
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];

export interface ReconciliationReport {
  escrow: string;
  claims: string;
  drift: string;
  balanced: boolean;
  breakdown: Partial<Record<BreakdownKey, string>>;
  negativeWallets: unknown[];
}

/**
 * Bóc `{success, data}` (hoặc dạng đã bóc) của P3. Chỉ chấp nhận khi escrow/claims/drift đọc được thành tiền —
 * thiếu là "dữ liệu không dùng được", không phải "0".
 */
export function normalizeReconciliation(body: unknown): ReconciliationReport | null {
  const root = body as { data?: unknown } | null | undefined;
  const d = (root && typeof root === "object" && "data" in root && root.data && typeof root.data === "object" ? root.data : body) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!d || typeof d !== "object") return null;
  if (parseCents(d.escrow) === null || parseCents(d.claims) === null || parseCents(d.drift) === null) return null;
  const bd = d.breakdown && typeof d.breakdown === "object" ? (d.breakdown as Record<string, unknown>) : {};
  const breakdown: Partial<Record<BreakdownKey, string>> = {};
  for (const k of BREAKDOWN_KEYS) {
    const v = bd[k];
    if (typeof v === "string" && parseCents(v) !== null) breakdown[k] = v;
  }
  return {
    escrow: d.escrow as string,
    claims: d.claims as string,
    drift: d.drift as string,
    balanced: d.balanced === true,
    breakdown,
    negativeWallets: Array.isArray(d.negativeWallets) ? d.negativeWallets : [],
  };
}

/**
 * HTTP 409 của P3 = "có lệch" KÈM đầy đủ báo cáo — KHÔNG phải lỗi tải. Trả báo cáo từ lỗi 409, hoặc `null`
 * (caller ném lại lỗi gốc cho mọi trường hợp khác).
 */
export function reconciliationFromHttpError(error: unknown): ReconciliationReport | null {
  const res = (error as { response?: { status?: number; data?: unknown } } | null | undefined)?.response;
  if (!res || res.status !== 409) return null;
  return normalizeReconciliation(res.data);
}

export interface BalanceVerdict {
  /** `balanced === true` VÀ drift đọc được bằng 0 — hai nguồn phải cùng nói "cân" mới hiện "Cân bằng". */
  balanced: boolean;
  driftCents: bigint;
}

export function balanceVerdict(r: ReconciliationReport): BalanceVerdict {
  const driftCents = parseCents(r.drift) ?? 0n;
  return { balanced: r.balanced && driftCents === 0n, driftCents };
}

export type MoneyToken = "held" | "pending" | "available" | "locked" | "out" | "revenue";
export type MoneyParty = "Khách" | "PT" | "Phòng gym" | "Nền tảng";

export const CLAIM_ROWS: { key: BreakdownKey; party: MoneyParty; label: string; token: MoneyToken }[] = [
  { key: "clientBalances", party: "Khách", label: "Khách hàng — số dư ví", token: "held" },
  { key: "ptPending", party: "PT", label: "PT — đang chờ giải phóng", token: "pending" },
  { key: "ptAvailable", party: "PT", label: "PT — khả dụng", token: "available" },
  { key: "ptLocked", party: "PT", label: "PT — đã khoá chờ chi", token: "locked" },
  { key: "ptHoldback", party: "PT", label: "PT — tạm giữ", token: "out" },
  { key: "gymPending", party: "Phòng gym", label: "Phòng gym — đang chờ giải phóng", token: "pending" },
  { key: "gymAvailable", party: "Phòng gym", label: "Phòng gym — khả dụng", token: "available" },
  { key: "gymLocked", party: "Phòng gym", label: "Phòng gym — đã khoá chờ chi", token: "locked" },
  { key: "platformRevenuePending", party: "Nền tảng", label: "Nền tảng — doanh thu chờ", token: "pending" },
  { key: "platformRevenueAvailable", party: "Nền tảng", label: "Nền tảng — doanh thu đã hưởng", token: "revenue" },
];

export interface MoneySegment {
  key: BreakdownKey;
  party: MoneyParty;
  label: string;
  token: MoneyToken;
  /** xu; `null` nếu backend không trả ngăn này. */
  cents: bigint | null;
  dong: bigint | null;
  shareBp: number | null;
}

export interface MoneyMap {
  segments: MoneySegment[];
  claimsCents: bigint;
  /** claims − Σ các ngăn đọc được. ≠ 0 nghĩa là bản đồ không khớp tổng quyền đòi (thiếu ngăn / dữ liệu lạ). */
  unexplainedCents: bigint;
  missingKeys: BreakdownKey[];
}

/** Mẫu số = `claims` (các ngăn chính là quyền đòi); khi sổ cân bằng nó bằng đúng `escrow`. */
export function buildMoneyMap(r: ReconciliationReport): MoneyMap {
  const claimsCents = parseCents(r.claims) ?? 0n;
  let explained = 0n;
  const missingKeys: BreakdownKey[] = [];
  const segments = CLAIM_ROWS.map((row) => {
    const cents = r.breakdown[row.key] === undefined ? null : parseCents(r.breakdown[row.key]);
    if (cents === null) missingKeys.push(row.key);
    else explained += cents;
    return {
      ...row,
      cents,
      dong: cents === null ? null : centsToDong(cents),
      shareBp: shareBp(cents, claimsCents),
    };
  });
  return { segments, claimsCents, unexplainedCents: claimsCents - explained, missingKeys };
}

// ───────────────────────────────────────────────────── P4 — theo kỳ ──
export type GroupBy = "day" | "week" | "month" | "quarter";
export type PeriodPreset = "7d" | "30d" | "month" | "custom";

export const GROUP_LABEL: Record<GroupBy, string> = { day: "Ngày", week: "Tuần", month: "Tháng", quarter: "Quý" };
export const GROUP_NOUN: Record<GroupBy, string> = { day: "ngày", week: "tuần", month: "tháng", quarter: "quý" };
export const PERIOD_LABEL: Record<PeriodPreset, string> = { "7d": "7 ngày", "30d": "30 ngày", month: "Tháng này", custom: "Tuỳ chọn" };

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isGroupBy = (v: unknown): v is GroupBy => v === "day" || v === "week" || v === "month" || v === "quarter";
export const isPreset = (v: unknown): v is PeriodPreset => v === "7d" || v === "30d" || v === "month" || v === "custom";

/** "YYYY-MM-DD" hợp lệ (đúng lịch) → ms UTC 00:00; không thì `null`. */
export function parseDateInput(v: unknown): number | null {
  if (typeof v !== "string" || !DATE_RE.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === v ? ms : null;
}

export const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface PeriodState {
  preset: PeriodPreset;
  group: GroupBy;
  from: string;
  to: string;
}

/** Ngày UTC (YYYY-MM-DD) của `nowMs`. Backend nhóm theo UTC nên bộ chọn cũng theo ngày UTC. */
export function utcToday(nowMs: number): string {
  return isoDate(nowMs);
}

/** Khoảng ngày (gồm cả hai đầu) cho từng mức đặt sẵn. `custom` giữ nguyên from/to đã nhập. */
export function presetRange(preset: Exclude<PeriodPreset, "custom">, nowMs: number): { from: string; to: string } {
  const today = parseDateInput(utcToday(nowMs)) as number;
  if (preset === "7d") return { from: isoDate(today - 6 * DAY_MS), to: isoDate(today) };
  if (preset === "30d") return { from: isoDate(today - 29 * DAY_MS), to: isoDate(today) };
  const d = new Date(today);
  return { from: isoDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), to: isoDate(today) };
}

/** Đọc trạng thái kỳ từ query string; giá trị lạ → mặc định (30 ngày, theo ngày). */
export function periodFromSearch(search: URLSearchParams, nowMs: number): PeriodState {
  const group = isGroupBy(search.get("group")) ? (search.get("group") as GroupBy) : "day";
  const presetRaw = search.get("period");
  const preset: PeriodPreset = isPreset(presetRaw) ? presetRaw : "30d";
  if (preset === "custom") {
    const f = search.get("from");
    const t = search.get("to");
    if (parseDateInput(f) !== null && parseDateInput(t) !== null) return { preset, group, from: f as string, to: t as string };
    return { preset: "30d", group, ...presetRange("30d", nowMs) };
  }
  return { preset, group, ...presetRange(preset, nowMs) };
}

/** Ngược lại: chỉ ghi vào URL những gì khác mặc định. */
export function periodToSearch(p: PeriodState): URLSearchParams {
  const s = new URLSearchParams();
  if (p.preset !== "30d") s.set("period", p.preset);
  if (p.group !== "day") s.set("group", p.group);
  if (p.preset === "custom") {
    s.set("from", p.from);
    s.set("to", p.to);
  }
  return s;
}

export type RangeProblem = "INVALID_DATE" | "FROM_AFTER_TO" | "FUTURE";

/** Kiểm khoảng tuỳ chọn trước khi gọi API (backend vẫn là nơi quyết định, trả 400 INVALID_RANGE). */
export function checkRange(from: string, to: string, nowMs: number): RangeProblem | null {
  const f = parseDateInput(from);
  const t = parseDateInput(to);
  if (f === null || t === null) return "INVALID_DATE";
  if (f > t) return "FROM_AFTER_TO";
  if (t > (parseDateInput(utcToday(nowMs)) as number)) return "FUTURE";
  return null;
}

export const RANGE_PROBLEM_TEXT: Record<RangeProblem, string> = {
  INVALID_DATE: "Chọn ngày bắt đầu và ngày kết thúc hợp lệ.",
  FROM_AFTER_TO: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.",
  FUTURE: "Ngày kết thúc không được ở tương lai.",
};

/**
 * Tham số gửi API (giữ nguyên ngữ nghĩa cũ): `from` = 00:00 UTC ngày bắt đầu, `to` = 00:00 UTC của ngày SAU ngày
 * kết thúc (để bao trọn ngày cuối).
 */
export function toApiRange(from: string, to: string): { from: string; to: string } {
  const f = parseDateInput(from) as number;
  const t = parseDateInput(to) as number;
  return { from: new Date(f).toISOString(), to: new Date(t + DAY_MS).toISOString() };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Nhãn cột theo UTC — cùng múi giờ backend dùng để nhóm. */
export function bucketLabel(periodIso: string, groupBy: GroupBy): string {
  const d = new Date(periodIso);
  if (Number.isNaN(d.getTime())) return "—";
  const dm = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
  if (groupBy === "day") return dm;
  if (groupBy === "week") return `Tuần ${dm}`;
  if (groupBy === "month") return `${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1}/${d.getUTCFullYear()}`;
}

export interface FinanceBucket {
  period: string;
  income: string;
  expense: string;
  netRevenue: string;
}

export interface FinanceOverviewReport {
  buckets: FinanceBucket[];
  totals: { income: string; expense: string; netRevenue: string };
  platformRevenue: { available: string; pending: string; asOf: string | null } | null;
}

/** Bóc P4. Totals phải đọc được thành tiền, nếu không là dữ liệu hỏng (→ "—", không phải 0). */
export function normalizeFinanceOverview(body: unknown): FinanceOverviewReport | null {
  const root = body as { data?: unknown } | null | undefined;
  const d = (root && typeof root === "object" && "data" in root && root.data && typeof root.data === "object" ? root.data : body) as
    | Record<string, any>
    | null
    | undefined;
  if (!d || typeof d !== "object") return null;
  const t = d.totals;
  if (!t || parseCents(t.income) === null || parseCents(t.expense) === null || parseCents(t.netRevenue) === null) return null;
  const buckets: FinanceBucket[] = Array.isArray(d.buckets)
    ? d.buckets.filter((b: any) => b && typeof b.period === "string")
    : [];
  const pr = d.platformRevenue;
  return {
    buckets,
    totals: { income: t.income, expense: t.expense, netRevenue: t.netRevenue },
    platformRevenue:
      pr && parseCents(pr.available) !== null && parseCents(pr.pending) !== null
        ? { available: pr.available, pending: pr.pending, asOf: typeof pr.asOf === "string" ? pr.asOf : null }
        : null,
  };
}

// ────────────────────────────────────────────────────── biểu đồ (hiển thị) ──
export interface ChartPoint {
  label: string;
  income: bigint;
  expense: bigint;
}

/** Chuỗi cho biểu đồ. Một giá trị không đọc được làm cả cột hỏng → trả `null` để UI hiện lỗi thay vì vẽ cột 0. */
export function buildChartPoints(buckets: FinanceBucket[], groupBy: GroupBy): ChartPoint[] | null {
  const points: ChartPoint[] = [];
  for (const b of buckets) {
    const income = parseMoney(b.income);
    const expense = parseMoney(b.expense);
    if (income === null || expense === null) return null;
    points.push({ label: bucketLabel(b.period, groupBy), income, expense });
  }
  return points;
}

/** Bước trục Y "đẹp" (1/2/2,5/5 × 10^k đồng) sao cho tối đa ~5 vạch. Chỉ dùng để vẽ (số thực chấp nhận được ở đây). */
export function niceScale(maxDong: number): { step: number; top: number } {
  if (!(maxDong > 0)) return { step: 1, top: 1 };
  const mags = [1, 2, 2.5, 5];
  for (let exp = 0; exp < 15; exp++) {
    for (const m of mags) {
      const step = m * 10 ** exp;
      if (maxDong / step <= 5) return { step, top: Math.ceil(maxDong / step) * step };
    }
  }
  return { step: maxDong, top: maxDong };
}

/** Nhãn trục: 1.500.000 → "1,5 tr"; 40.000.000 → "40 tr"; 850.000 → "850 k"; 2.000.000.000 → "2 tỷ". */
export function axisLabel(dong: number): string {
  if (dong === 0) return "0";
  const fmt = (n: number, unit: string) => `${String(Math.round(n * 10) / 10).replace(".", ",")} ${unit}`;
  if (dong >= 1_000_000_000) return fmt(dong / 1_000_000_000, "tỷ");
  if (dong >= 1_000_000) return fmt(dong / 1_000_000, "tr");
  if (dong >= 1_000) return fmt(dong / 1_000, "k");
  return String(dong);
}

// ──────────────────────────────────────────────────────── thời gian / cũ ──
const VN_DATETIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const VN_TIME = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });

/** ISO UTC → "26/10/2026 14:32" giờ Việt Nam; không đọc được → "—". */
export function formatVnDateTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = Object.fromEntries(VN_DATETIME.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** → "14:32" giờ Việt Nam. */
export function formatVnTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return VN_TIME.format(new Date(ms));
}

export function ageMinutes(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
}

/** "dưới 1 phút" / "3 phút" / "2 giờ" / "3 ngày". */
export function ageText(minutes: number): string {
  if (minutes < 1) return "dưới 1 phút";
  if (minutes < 60) return `${minutes} phút`;
  if (minutes < 60 * 48) return `${Math.floor(minutes / 60)} giờ`;
  return `${Math.floor(minutes / (60 * 24))} ngày`;
}

export interface Staleness {
  stale: boolean;
  /** Dữ liệu đang hiện được lấy lúc nào (ms). */
  updatedAt: number;
  minutes: number;
  /** Vì sao: lần tải lại thất bại (số vẫn là bản cũ), hay chỉ quá tuổi. */
  reason: "REFETCH_FAILED" | "TOO_OLD" | null;
}

/**
 * E-08: có số rồi nhưng lần tải lại hỏng hoặc quá cũ → chip "Dữ liệu lúc HH:mm — đã cũ N phút".
 * `hasData=false` → không có gì để gọi là cũ.
 */
export function staleness(args: { hasData: boolean; updatedAt: number; refetchFailed: boolean; nowMs: number; maxAgeMs: number }): Staleness {
  const { hasData, updatedAt, refetchFailed, nowMs, maxAgeMs } = args;
  const minutes = ageMinutes(updatedAt, nowMs);
  if (!hasData || !updatedAt) return { stale: false, updatedAt, minutes, reason: null };
  if (refetchFailed) return { stale: true, updatedAt, minutes, reason: "REFETCH_FAILED" };
  if (nowMs - updatedAt >= maxAgeMs) return { stale: true, updatedAt, minutes, reason: "TOO_OLD" };
  return { stale: false, updatedAt, minutes, reason: null };
}

// ──────────────────────────────────────────────────── hàng đợi tài chính ──
export const WITHDRAWAL_LIST_CAP = 100;

export interface WithdrawalRowLike {
  status?: string;
  amount?: unknown;
  createdAt?: string;
  reviewedAt?: string | null;
}

export interface QueueSummary {
  count: number;
  /** Σ số tiền (đồng); `null` nếu có dòng không đọc được số tiền. */
  totalDong: bigint | null;
  /** Phút kể từ mốc cũ nhất (PENDING: createdAt; APPROVED: reviewedAt); `null` nếu không có mốc. */
  oldestMinutes: number | null;
}

export interface WithdrawalQueues {
  pending: QueueSummary;
  approved: QueueSummary;
  /** P7 trần 100 dòng: đúng 100 thì có thể còn nữa → số đếm là "≥". */
  capped: boolean;
}

function summarize(rows: WithdrawalRowLike[], timeOf: (r: WithdrawalRowLike) => string | null | undefined, nowMs: number): QueueSummary {
  const cents = sumCents(rows.map((r) => r.amount));
  let oldest: number | null = null;
  for (const r of rows) {
    const t = Date.parse(timeOf(r) ?? "");
    if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t;
  }
  return {
    count: rows.length,
    totalDong: cents === null ? null : centsToDong(cents),
    oldestMinutes: oldest === null ? null : ageMinutes(oldest, nowMs),
  };
}

/** P7 trả PENDING + APPROVED trộn lẫn. `null` nếu `list` không phải mảng (coi như lỗi, không coi là rỗng). */
export function summarizeWithdrawals(list: unknown, nowMs: number): WithdrawalQueues | null {
  if (!Array.isArray(list)) return null;
  const rows = list as WithdrawalRowLike[];
  return {
    pending: summarize(rows.filter((r) => r?.status === "PENDING"), (r) => r.createdAt, nowMs),
    approved: summarize(rows.filter((r) => r?.status === "APPROVED"), (r) => r.reviewedAt, nowMs),
    capped: rows.length >= WITHDRAWAL_LIST_CAP,
  };
}
