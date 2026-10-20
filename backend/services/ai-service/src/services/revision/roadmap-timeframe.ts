/**
 * Phase 3 (AI plan) — the TIME CONTRACT of a chat-created roadmap (audit BDG-18: the chat path hard-coded `timeframeWeeks: 16`, so
 * "tạo lộ trình 12 tuần" and "tạo lộ trình không giới hạn thời gian" both produced a 16-week roadmap).
 *
 *   - the user states a deadline        -> that deadline (weeks) is used
 *   - the user says "no time limit"      -> NO fixed deadline is imposed (the generator proposes a reasonable length)
 *   - the user states nothing            -> a single, named default (DEFAULT_ROADMAP_TIMEFRAME_WEEKS), which the reply DISCLOSES
 *   - two conflicting statements         -> AMBIGUOUS: the agent asks instead of guessing
 *
 * Pure functions over the diacritic-stripped, lower-cased text (`normalizeAgentText`); no I/O.
 */

/** The ONE place the default lives. Used only when the user said nothing about time, and always disclosed in the reply. */
import { normalizeAgentText } from "../fitness-agent-intent";

export const DEFAULT_ROADMAP_TIMEFRAME_WEEKS = 16;
/** fitness-service caps a roadmap at 104 weeks in total and the draft schema at timeframeWeeks <= 104. */
export const MAX_ROADMAP_TIMEFRAME_WEEKS = 104;

export type RoadmapTimeframeStatement =
  | { kind: "WEEKS"; weeks: number; capped: boolean }
  | { kind: "UNLIMITED" }
  | { kind: "AMBIGUOUS"; reason: string }
  | { kind: "UNSPECIFIED" };

/** What the roadmap is generated with, and where the value came from (stored on the draft so a revision never re-hard-codes it). */
export type RoadmapTimeframe =
  | { source: "USER"; weeks: number; capped: boolean }
  | { source: "DEFAULT"; weeks: number }
  | { source: "UNLIMITED"; weeks: null };

const UNLIMITED_RE = /\b(?:khong gioi han(?: thoi gian| thoi han)?|khong (?:dat|can|co|ep|bi ep) (?:thoi gian|thoi han|han|deadline)|khong (?:thoi han|deadline)|khong voi|khong gap|thoai mai thoi gian|bao lau cung duoc|lau dai|khong ap luc thoi gian)\b/;
// "12 tuan", "3 thang", "90 ngay", "1.5 nam"; "moi 2 tuan" (= every two weeks) is a frequency, never a deadline.
const AMOUNT_RE = /(?<![a-z0-9])(?:(moi)\s+)?(\d+(?:[.,]\d+)?)\s*(tuan|thang|ngay|nam)\b/g;
const HALF_YEAR_RE = /\bnua nam\b/;
const ONE_YEAR_RE = /\bmot nam\b/;

function toWeeks(amount: number, unit: string): number {
  if (unit === "tuan") return amount;
  if (unit === "thang") return amount * 4.345;
  if (unit === "ngay") return amount / 7;
  return amount * 52; // nam
}

/** Reads what the user said about the roadmap's length in ONE message. */
export function parseRoadmapTimeframe(normalizedText: string): RoadmapTimeframeStatement {
  const s = normalizedText.replace(/\s+/g, " ").trim();
  const candidates: number[] = [];
  for (const m of s.matchAll(AMOUNT_RE)) {
    if (m[1] === "moi") continue; // "mỗi 2 tuần": a frequency
    const amount = Number(m[2].replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) continue;
    candidates.push(toWeeks(amount, m[3]));
  }
  if (HALF_YEAR_RE.test(s)) candidates.push(26);
  if (ONE_YEAR_RE.test(s)) candidates.push(52);
  const unlimited = UNLIMITED_RE.test(s);
  if (unlimited && candidates.length > 0) return { kind: "AMBIGUOUS", reason: "vừa nói không giới hạn thời gian vừa nêu một thời hạn cụ thể" };
  if (unlimited) return { kind: "UNLIMITED" };
  if (candidates.length === 0) return { kind: "UNSPECIFIED" };
  const distinct = [...new Set(candidates.map((w) => Math.max(1, Math.round(w))))];
  if (distinct.length > 1) return { kind: "AMBIGUOUS", reason: "nêu nhiều thời hạn khác nhau" };
  const weeks = distinct[0];
  return weeks > MAX_ROADMAP_TIMEFRAME_WEEKS
    ? { kind: "WEEKS", weeks: MAX_ROADMAP_TIMEFRAME_WEEKS, capped: true }
    : { kind: "WEEKS", weeks, capped: false };
}

/**
 * Resolves the time contract from the user's messages, MOST RECENT FIRST (the current message, then earlier ones of the same
 * conversation): the newest explicit statement wins; if none, the named default applies. An ambiguous newest statement is returned
 * as such so the caller can ask.
 */
export function resolveRoadmapTimeframe(messagesNewestFirst: string[]): { timeframe: RoadmapTimeframe } | { ambiguous: string } {
  for (const text of messagesNewestFirst) {
    const st = parseRoadmapTimeframe(normalizeAgentText(text));
    if (st.kind === "UNSPECIFIED") continue;
    if (st.kind === "AMBIGUOUS") return { ambiguous: st.reason };
    if (st.kind === "UNLIMITED") return { timeframe: { source: "UNLIMITED", weeks: null } };
    return { timeframe: { source: "USER", weeks: st.weeks, capped: st.capped } };
  }
  return { timeframe: { source: "DEFAULT", weeks: DEFAULT_ROADMAP_TIMEFRAME_WEEKS } };
}

/** The `timeframeWeeks` input of the draft generator: undefined means "no fixed deadline" (never a hidden number). */
export const timeframeForGenerator = (t: RoadmapTimeframe): number | undefined => (t.weeks === null ? undefined : t.weeks);

/** Whole weeks the draft's phases actually add up to (0 when unreadable). */
export function draftTotalWeeks(draft: { phases?: Array<{ plannedStartAt?: string; plannedEndAt?: string; plannedDurationWeeks?: number }> } | null | undefined): number {
  if (!Array.isArray(draft?.phases)) return 0;
  return draft!.phases!.reduce((sum, p) => {
    const start = new Date(p.plannedStartAt ?? "").getTime();
    const end = new Date(p.plannedEndAt ?? "").getTime();
    if (Number.isFinite(start) && Number.isFinite(end)) return sum + Math.round((end - start) / (7 * 86_400_000));
    return sum + (typeof p.plannedDurationWeeks === "number" ? p.plannedDurationWeeks : 0);
  }, 0);
}

/** A requested length is "met" when the draft is within max(1 week, 10%) of it. */
export function timeframeMet(requestedWeeks: number, actualWeeks: number): boolean {
  return Math.abs(actualWeeks - requestedWeeks) <= Math.max(1, Math.round(requestedWeeks * 0.1));
}

/** Plain-language disclosure of which time contract was applied and what the draft really delivers. Never claims more than is true. */
export function describeTimeframe(t: RoadmapTimeframe, actualWeeks: number): string {
  const actual = actualWeeks > 0 ? `${actualWeeks} tuần` : "độ dài do AI đề xuất";
  if (t.source === "UNLIMITED") {
    return `Bạn không muốn đặt thời hạn nên mình không ép khung thời gian; lộ trình AI đề xuất dài ${actual}. Nói “trong 12 tuần” (hoặc số khác) nếu bạn muốn một mốc cụ thể.`;
  }
  if (t.source === "DEFAULT") {
    return `Bạn chưa nêu thời hạn nên mình dùng mặc định ${t.weeks} tuần${actualWeeks > 0 && !timeframeMet(t.weeks, actualWeeks) ? ` (lộ trình AI đề xuất thực tế dài ${actual})` : ""}. Nói “trong 12 tuần” hoặc “không giới hạn thời gian” để đổi.`;
  }
  const cap = t.capped ? ` (mình giới hạn ở mức tối đa ${MAX_ROADMAP_TIMEFRAME_WEEKS} tuần)` : "";
  return timeframeMet(t.weeks, actualWeeks) || actualWeeks === 0
    ? `Lộ trình dài ${actualWeeks || t.weeks} tuần theo yêu cầu của bạn${cap}.`
    : `Bạn yêu cầu ${t.weeks} tuần${cap} nhưng AI chỉ xếp được ${actual}. Mình hiển thị đúng độ dài thực tế; bạn có thể nhắn “đổi sang ${t.weeks} tuần” để thử lại.`;
}
