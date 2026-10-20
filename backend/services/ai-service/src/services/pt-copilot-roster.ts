/**
 * Phase 4 (AI plan) — PT Copilot, chat entry for the roster adherence overview. Pure and deterministic: a strict question matcher and a
 * formatter over the roster read that fitness-service already computed. There is NO model in this path (nothing can be invented), the
 * caller's authority is the roster itself (fitness-service derives it from the verified PT's ACTIVE contracts), and the reply is read-only:
 * it never contacts a client and never changes client data (that comes later, behind an explicit approval).
 */
import { normalizeAgentText } from "./fitness-agent-intent";

export type RosterWindowDays = 7 | 14 | 28;

export interface RosterRowView {
  clientUserId: string;
  status: "AT_RISK" | "NEEDS_ATTENTION" | "ON_TRACK" | "NO_DATA";
  workout: { scheduled: number; completed: number; adherencePercent: number | null };
  signals: Array<{ code: string; severity: string; evidence: string }>;
  dataGaps: string[];
}
export interface RosterView {
  window: { days: number };
  summary: { totalClients: number; AT_RISK: number; NEEDS_ATTENTION: number; ON_TRACK: number; NO_DATA: number };
  clients: RosterRowView[];
}

// A PT-side subject ("client", "học viên", "khách của tôi"…) AND a concern about progress/adherence. Both are required so an ordinary
// customer's "tiến độ của tôi" or a general fitness question is never taken over.
const SUBJECT = /\b(client|clients|hoc vien|hoc vien cua (?:toi|minh)|khach hang cua (?:toi|minh)|khach cua (?:toi|minh)|nguoi tap cua (?:toi|minh)|hoi vien cua (?:toi|minh))\b/;
const CONCERN = /\b(cham tien do|tien do|tuan thu|bo tap|bo buoi|can chu y|can quan tam|nguy co|dang the nao|tinh hinh|tinh trang|dang tap tot|ai (?:can|dang)|nao (?:dang|can)|bo bua|khong tap|ngung tap|on dinh|kem)\b/;
const OWN_DATA = /\b(cua toi|cua minh)\b.*\b(tien do|can nang|calo)\b/;

export function isPtRosterAdherenceQuestion(rawText: string): boolean {
  if (/[a-z]/i.test(rawText) === false) return false;
  const s = normalizeAgentText(rawText);
  if (s.split(" ").length > 30) return false;
  return SUBJECT.test(s) && CONCERN.test(s) && !(OWN_DATA.test(s) && !/\b(client|hoc vien)\b/.test(s));
}

/** "7 ngày / 1 tuần" -> 7, "2 tuần / 14 ngày" (default) -> 14, "1 tháng / 4 tuần / 28 ngày" -> 28. */
export function parseRosterWindow(rawText: string): RosterWindowDays {
  const s = normalizeAgentText(rawText);
  if (/\b(1 thang|mot thang|thang nay|4 tuan|28 ngay)\b/.test(s)) return 28;
  if (/\b(1 tuan|mot tuan|7 ngay|tuan nay|tuan qua)\b/.test(s)) return 7;
  return 14;
}

const GAP_VI: Record<string, string> = {
  NO_SCHEDULED_SESSIONS: "chưa có buổi tập nào được lên lịch trong khoảng này",
  NO_ACTIVE_NUTRITION_PROGRAM: "chưa có thực đơn đang áp dụng",
  NO_NUTRITION_LOGS: "chưa ghi nhận bữa ăn nào",
};
const MAX_LISTED = 8;

/** Plain-language overview. `names` maps clientUserId -> display name (from the PT's own contracts); unknown ids get a short neutral label. */
export function formatRosterOverview(view: RosterView, names: ReadonlyMap<string, string>): string {
  const nameOf = (id: string) => names.get(id)?.trim() || `Client …${id.slice(-4)}`;
  const { summary: s, window } = view;
  if (s.totalClients === 0) {
    return "Mình không thấy client nào đang có hợp đồng còn hiệu lực (ACTIVE) với bạn nên chưa có gì để tổng hợp. Mình chỉ đọc dữ liệu của những client bạn đang huấn luyện.";
  }
  const lines: string[] = [];
  lines.push(`Tổng hợp ${s.totalClients} client trong ${window.days} ngày gần nhất: ${s.AT_RISK} cần xử lý ngay, ${s.NEEDS_ATTENTION} cần chú ý, ${s.ON_TRACK} đang ổn, ${s.NO_DATA} chưa đủ dữ liệu để nhận định.`);
  const flagged = view.clients.filter((c) => c.status === "AT_RISK" || c.status === "NEEDS_ATTENTION");
  if (flagged.length) {
    lines.push("", "**Cần xem xét:**");
    for (const c of flagged.slice(0, MAX_LISTED)) {
      lines.push(`- **${nameOf(c.clientUserId)}** (${c.status === "AT_RISK" ? "cần xử lý ngay" : "cần chú ý"}):`);
      for (const sig of c.signals) lines.push(`  - ${sig.evidence}`);
      if (c.dataGaps.length) lines.push(`  - Thiếu dữ liệu: ${c.dataGaps.map((g) => GAP_VI[g] ?? g).join("; ")}.`);
    }
    if (flagged.length > MAX_LISTED) lines.push(`- …và ${flagged.length - MAX_LISTED} client khác cũng cần xem xét.`);
  }
  const noData = view.clients.filter((c) => c.status === "NO_DATA");
  if (noData.length) {
    lines.push("", "**Chưa đủ dữ liệu để nhận định** (mình không đoán):");
    for (const c of noData.slice(0, MAX_LISTED)) lines.push(`- ${nameOf(c.clientUserId)}: ${c.dataGaps.map((g) => GAP_VI[g] ?? g).join("; ") || "không có dữ liệu"}.`);
    if (noData.length > MAX_LISTED) lines.push(`- …và ${noData.length - MAX_LISTED} client khác.`);
  }
  if (s.ON_TRACK > 0) lines.push("", `${s.ON_TRACK} client còn lại đang ổn theo dữ liệu hiện có.`);
  lines.push("", "Đây là số liệu tổng hợp từ lịch tập và nhật ký bữa ăn đã ghi nhận; mình chưa nhắn tin hay thay đổi gì cho client nào.");
  return lines.join("\n");
}
