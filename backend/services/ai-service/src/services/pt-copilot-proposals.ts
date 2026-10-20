/**
 * Phase 4 (AI plan) — PT Copilot, step 2: DRAFTED proposals for a PT to review ("Đề xuất cách xử lý cho client chậm tiến độ").
 *
 * Plan §5.3 contract: the Copilot may DRAFT a message / a plan-review suggestion / a check-in question list for the PT to approve; it does
 * NOT send anything and does NOT change client data. Everything here is pure and deterministic (templates filled from the evidence that
 * the roster engine already computed): no model, so nothing can be invented, no health claim can appear, and every sentence that cites
 * a number cites the real one. The client can only be chosen from the PT's own roster (see pickProposalClient).
 */
import { normalizeAgentText } from "./fitness-agent-intent";
import type { RosterRowView } from "./pt-copilot-roster";

export type ProposalType = "MESSAGE_DRAFT" | "PLAN_REVIEW_SUGGESTION" | "CHECKIN_QUESTION" | "ASSIGN_PLAN_SUGGESTION";
export interface ClientProposal { type: ProposalType; title: string; body: string; basedOn: string[] }

// PT-side subject AND an explicit ask to draft/propose/handle. ("client nào chậm tiến độ?" alone is the overview, not this.)
const SUBJECT = /\b(client|clients|hoc vien|khach hang cua (?:toi|minh)|khach cua (?:toi|minh)|nguoi tap cua (?:toi|minh)|hoi vien cua (?:toi|minh))\b/;
const ASK = /\b(de xuat|soan|goi y|nen lam gi|xu ly|nhac nho|nhan tin|lien he|tiep can|dong vien|khuyen khich|ke hoach cham soc|cham soc|can lam gi)\b/;

export function isPtProposalRequest(rawText: string): boolean {
  if (!/[a-z]/i.test(rawText)) return false;
  const s = normalizeAgentText(rawText);
  if (s.split(" ").length > 40) return false;
  return SUBJECT.test(s) && ASK.test(s);
}

const STOP = new Set([
  "client", "clients", "hoc", "vien", "cho", "toi", "minh", "nao", "nen", "lam", "gi", "de", "xuat", "soan", "goi", "xu", "ly", "nhac", "nho", "nhan", "tin",
  "lien", "he", "tiep", "can", "dong", "khuyen", "khich", "cham", "soc", "cua", "voi", "ve", "cac", "nhung", "mot", "va", "la", "dang", "bi", "tien", "do",
  "nguy", "co", "ai", "giup", "hay", "xin", "vui", "long", "the", "nhu", "khach", "hang", "nguoi", "tap", "hoi", "ke", "hoach", "hom", "nay", "tuan", "thang",
  "ngay", "gan", "day", "nhat", "hiem", "tot", "kem", "nhieu", "chu", "y", "bo", "buoi", "on", "dinh", "nhom", "tat", "ca", "moi", "qua", "vua", "ban", "anh", "chi", "em",
  "khong", "duoc", "can", "phai", "se", "thi", "ma", "nay", "kia", "do", "nhe", "nha", "voi", "them", "ngoai", "trong", "tren", "duoi", "lai", "sau", "truoc",
]);

// A name follows an INTRODUCER word ("client", "học viên", "khách", "cho", "với", "anh/chị/em/bạn") possibly through other stop-words
// ("cho học viên An"). That lets a 2-letter name such as "An" be used, while the common word "ăn" elsewhere in a sentence is not one.
const INTRODUCERS = new Set(["client", "clients", "vien", "khach", "hang", "cho", "voi", "anh", "chi", "em", "ban", "nguoi"]);
const labelTokens = (label: string) => normalizeAgentText(label.split("@")[0]).split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
function askedNames(text: string): string[] {
  const tokens = normalizeAgentText(text).split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  let armed = false;
  for (const t of tokens) {
    if (INTRODUCERS.has(t)) { armed = true; continue; }
    if (STOP.has(t)) continue;           // stop-words keep the introducer armed ("cho hoc vien An")
    if (armed && t.length >= 2) out.push(t);
    armed = false;
  }
  return [...new Set(out)];
}
const longTokens = (text: string) => normalizeAgentText(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));

export type PickedClient =
  | { kind: "CLIENT"; row: RosterRowView; label: string }
  | { kind: "AMBIGUOUS"; labels: string[] }
  | { kind: "NOT_FOUND" }
  | { kind: "NONE_FLAGGED" };

/**
 * Chooses the client the proposal is for — ONLY among the PT's own roster rows. A NAME the PT typed that matches nobody on the roster is
 * NOT_FOUND (and the reply never reveals whether such a person exists elsewhere) — the proposal is never silently drafted for someone else.
 * With no name given, the client who most needs attention (the roster is already sorted by need) is used; if nobody is flagged there is
 * nothing to propose.
 */
export function pickProposalClient(rawText: string, rows: RosterRowView[], names: ReadonlyMap<string, string>): PickedClient {
  const labelOf = (r: RosterRowView) => names.get(r.clientUserId)?.trim() || `Client …${r.clientUserId.slice(-4)}`;
  const explicit = askedNames(rawText);
  const asked = new Set([...explicit, ...longTokens(rawText)]);
  const matches = asked.size === 0 ? [] : rows.filter((r) => labelTokens(labelOf(r)).some((t) => asked.has(t)));
  if (matches.length === 1) return { kind: "CLIENT", row: matches[0], label: labelOf(matches[0]) };
  if (matches.length > 1) return { kind: "AMBIGUOUS", labels: matches.map(labelOf) };
  if (explicit.length > 0) return { kind: "NOT_FOUND" };
  const first = rows.find((r) => r.status === "AT_RISK" || r.status === "NEEDS_ATTENTION");
  return first ? { kind: "CLIENT", row: first, label: labelOf(first) } : { kind: "NONE_FLAGGED" };
}

/** What to call the client INSIDE a message: a real name's first word, never an email or an id. */
export function greetingName(label: string): string {
  if (label.includes("@") || /^Client …/.test(label)) return "bạn";
  return label.trim().split(/\s+/).slice(-1)[0] || "bạn";
}

const MAX_PROPOSALS = 4;

export function buildClientProposals(row: RosterRowView, label: string, windowDays: number): ClientProposal[] {
  const n = greetingName(label);
  const w = row.workout;
  const ev = (code: string) => row.signals.find((s) => s.code === code)?.evidence;
  const out: ClientProposal[] = [];
  const has = (code: string) => row.signals.some((s) => s.code === code);
  const push = (p: ClientProposal) => { if (!out.some((x) => x.type === p.type)) out.push(p); };

  if (has("NO_COMPLETED_SESSIONS")) {
    push({ type: "MESSAGE_DRAFT", title: "Tin nhắn hỏi thăm", basedOn: [ev("NO_COMPLETED_SESSIONS")!],
      body: `Chào ${n}, mình thấy ${windowDays} ngày gần đây lịch đã xếp ${w.scheduled} buổi nhưng chưa có buổi nào được ghi nhận hoàn thành. Có điều gì đang khiến việc tập khó hơn với bạn không (thời gian, lịch tập chưa hợp, mệt…)? Bạn cứ nói thật để mình điều chỉnh cho vừa sức nhé.` });
    push({ type: "PLAN_REVIEW_SUGGESTION", title: "Xem lại lịch tập của client", basedOn: [ev("NO_COMPLETED_SESSIONS")!],
      body: `Đối chiếu số buổi/tuần và khung giờ của lịch hiện tại với thực tế của client; cân nhắc giảm tạm thời số buổi hoặc đổi ngày tập. Mọi thay đổi do bạn thực hiện trong màn hình lịch tập của client — Copilot không tự chỉnh.` });
  } else if (has("LOW_ADHERENCE") || has("MODERATE_ADHERENCE")) {
    const e = (ev("LOW_ADHERENCE") ?? ev("MODERATE_ADHERENCE"))!;
    push({ type: "MESSAGE_DRAFT", title: "Tin nhắn động viên", basedOn: [e],
      body: `Chào ${n}, ${windowDays} ngày qua bạn đã hoàn thành ${w.completed}/${w.scheduled} buổi — mình ghi nhận những buổi bạn đã làm được. Buổi nào/ngày nào đang khó giữ nhất với bạn? Mình muốn xếp lại cho dễ theo hơn.` });
    if (has("LOW_ADHERENCE")) push({ type: "PLAN_REVIEW_SUGGESTION", title: "Xem lại lịch tập của client", basedOn: [e],
      body: `Tuân thủ thấp (${w.adherencePercent}%): xem lại số buổi/tuần và ngày tập so với lịch thực tế của client trước khi tăng tải. Việc chỉnh lịch do bạn thực hiện.` });
  }
  if (has("INACTIVE_WORKOUT")) {
    push({ type: "MESSAGE_DRAFT", title: "Tin nhắn nhắc lại", basedOn: [ev("INACTIVE_WORKOUT")!],
      body: `Chào ${n}, lâu rồi mình chưa thấy buổi tập mới của bạn. Tuần này mình bắt đầu lại nhẹ nhàng với một buổi ngắn được không? Mình sẽ đồng hành.` });
  }
  if (has("NUTRITION_NOT_LOGGED")) {
    push({ type: "CHECKIN_QUESTION", title: "Câu hỏi check-in về ăn uống", basedOn: [ev("NUTRITION_NOT_LOGGED")!],
      body: `1) Thực đơn hiện tại có khó theo không (món, thời gian nấu, ngân sách)?\n2) Bạn có thấy khó khi ghi lại bữa ăn trong ứng dụng không?\n3) Bữa nào trong ngày bạn hay bỏ nhất?` });
  }
  if (has("NUTRITION_SKIPPING")) {
    push({ type: "PLAN_REVIEW_SUGGESTION", title: "Xem lại thực đơn của client", basedOn: [ev("NUTRITION_SKIPPING")!],
      body: `Client bỏ nhiều bữa đã ghi nhận: xem lại số bữa/ngày và độ phức tạp của thực đơn, cân nhắc đơn giản hóa. Việc chỉnh thực đơn do bạn thực hiện.` });
  }
  if (row.dataGaps.includes("NO_SCHEDULED_SESSIONS")) {
    push({ type: "ASSIGN_PLAN_SUGGESTION", title: "Client chưa có lịch tập", basedOn: [`Không có buổi tập nào được lên lịch trong ${windowDays} ngày gần nhất.`],
      body: `Client chưa có buổi tập nào được lên lịch. Cân nhắc gán hoặc tạo chương trình tập cho client (trong màn hình huấn luyện của bạn).` });
  }
  return out.slice(0, MAX_PROPOSALS);
}

/** Text lines of an approved proposal set, for the PT to read/copy (the Copilot sends nothing). */
export function proposalLines(proposals: ClientProposal[]): string[] {
  const tag: Record<ProposalType, string> = { MESSAGE_DRAFT: "Tin nhắn", PLAN_REVIEW_SUGGESTION: "Gợi ý xem lại kế hoạch", CHECKIN_QUESTION: "Câu hỏi check-in", ASSIGN_PLAN_SUGGESTION: "Gợi ý gán kế hoạch" };
  return proposals.map((p) => `[${tag[p.type]}] ${p.title}: ${p.body}`);
}
