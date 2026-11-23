/**
 * Khiếu nại (batch G6) - pure functions, no React. The list and the detail are the ND-07 owner / manager complaint-case API
 * (`GET /owner/complaint-cases`, `GET /owner/complaint-cases/:id`); this file only turns what the server sent into rows, words and
 * guards. Nothing here decides a case: the decision, the appeal and the refund belong to Gymini and have no control in this workspace.
 * What the server withholds (the member's identity, findings, money, the investigation) is never reconstructed here.
 */
import type { OwnerCaseDetail, OwnerCaseListItem, OwnerEvidenceRow, PartyMoreInfo, GymEvidence } from "../../../pages/admin/complaints/gymCaseTypes";
import { parseGymError } from "../../../pages/admin/complaints/gymCaseErrors";
import { issueLabel } from "../../../pages/admin/complaints/gymCaseLabels";
import { describeEvidence } from "../../../pages/admin/complaints/gymCaseModel";
import type { TagTone } from "../scope/scopeModel";
import { stamp } from "../finance/financeModel";

export const CASES_ROOT = "/gym-owner/complaint-cases";

/** `/gym-owner/complaint-cases/<id>` keeping the branch the person is looking at (`?gymId=`), so Back returns to the same list. */
export function caseHref(caseId: string | null, gymId: string | null): string {
  const base = caseId ? `${CASES_ROOT}/${encodeURIComponent(caseId)}` : CASES_ROOT;
  return gymId && gymId !== "ALL" ? `${base}?gymId=${encodeURIComponent(gymId)}` : base;
}

// ----------------------------------------------------------------------------------------------------------------------- list rows
export type TaskKind = "awaiting" | "open" | "none";
export interface TaskView {
  kind: TaskKind;
  text: string;
  tone: TagTone;
}

/** What the GYM has to do, from the two flags the server sends. `awaitingYou` = Gymini asked this gym and it has not answered. */
export function taskOf(item: Pick<OwnerCaseListItem, "awaitingYou" | "canSubmit">): TaskView {
  if (item.awaitingYou) return { kind: "awaiting", text: "Cần phòng tập phản hồi", tone: "warn" };
  if (item.canSubmit) return { kind: "open", text: "Có thể gửi thêm giải trình", tone: "info" };
  return { kind: "none", text: "Không cần thêm từ phòng tập", tone: "neutral" };
}

export type DueState = "none" | "open" | "overdue";
export function dueOf(respondBy: string | null | undefined, nowMs: number): { state: DueState; text: string } {
  if (!respondBy) return { state: "none", text: "Không có hạn" };
  const t = new Date(respondBy).getTime();
  if (Number.isNaN(t)) return { state: "none", text: "Không có hạn" };
  const day = new Date(respondBy).toLocaleDateString("vi-VN");
  return t < nowMs ? { state: "overdue", text: `Quá hạn từ ${day}` } : { state: "open", text: `Hạn ${day}` };
}

export interface CaseRow {
  id: string;
  gymId: string;
  /** null when the branch is not in the list of branches this account sees (the chip then reads "--"). */
  gymName: string | null;
  typeText: string;
  /** The server's own Vietnamese progress sentence: never an internal status. */
  progress: string;
  task: TaskView;
  respondBy: string | null;
  createdAt: string;
}

export function caseRows(items: readonly OwnerCaseListItem[] | undefined, gyms: readonly { id: string; name: string }[]): CaseRow[] {
  const names = new Map(gyms.map((g) => [g.id, g.name]));
  return [...(items ?? [])]
    .map((i) => ({
      id: i.id,
      gymId: i.gymId,
      gymName: names.get(i.gymId) ?? null,
      typeText: issueLabel(i.issueType),
      progress: typeof i.progress === "string" && i.progress.trim() ? i.progress : "Đang xử lý",
      task: taskOf(i),
      respondBy: i.respondBy ?? null,
      createdAt: i.createdAt,
    }))
    .sort((a, b) => (a.task.kind === "awaiting" ? 0 : 1) - (b.task.kind === "awaiting" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));
}

/** The branch the scope strip selects. "ALL" keeps every row the server returned (the server already limited them to the account's branches). */
export function rowsInScope(rows: readonly CaseRow[], gymId: string): CaseRow[] {
  return gymId === "ALL" ? [...rows] : rows.filter((r) => r.gymId === gymId);
}

export type CaseFilter = "all" | "awaiting" | "open" | "closed";
export const CASE_FILTERS: readonly CaseFilter[] = ["all", "awaiting", "open", "closed"];
export const CASE_FILTER_LABEL: Record<CaseFilter, string> = {
  all: "Tất cả",
  awaiting: "Cần phản hồi",
  open: "Còn nhận giải trình",
  closed: "Không nhận thêm",
};
export function parseCaseFilter(raw: string | null | undefined): CaseFilter {
  return CASE_FILTERS.includes(raw as CaseFilter) ? (raw as CaseFilter) : "all";
}
export function filterRows(rows: readonly CaseRow[], filter: CaseFilter): CaseRow[] {
  if (filter === "all") return [...rows];
  const want: TaskKind = filter === "closed" ? "none" : filter;
  return rows.filter((r) => r.task.kind === want);
}
export function filterCounts(rows: readonly CaseRow[]): Record<CaseFilter, number> {
  return { all: rows.length, awaiting: rows.filter((r) => r.task.kind === "awaiting").length, open: rows.filter((r) => r.task.kind === "open").length, closed: rows.filter((r) => r.task.kind === "none").length };
}

/** Said under the list, always: the server has no status filter and no paging for this list, so these filters only cut the list already loaded. */
export const FILTER_LIMIT_NOTE = "Máy chủ trả toàn bộ hồ sơ của tài khoản này và không có bộ lọc trạng thái. Các bộ lọc ở đây chỉ lọc trong danh sách đã tải.";

export function listSummary(total: number, shown: number, branchName: string | null, filter: CaseFilter): string {
  if (total === 0) return "Chưa có hồ sơ khiếu nại nào.";
  const where = branchName ? ` của ${branchName}` : "";
  return filter === "all" ? `${shown} hồ sơ${where}.` : `${shown} hồ sơ${where} thuộc nhóm "${CASE_FILTER_LABEL[filter]}".`;
}

// ----------------------------------------------------------------------------------------------------------------------- detail
export interface CaseTimelineItem {
  key: string;
  at: string | null;
  title: string;
  text?: string;
  tone?: "risk";
  done: boolean;
}

/** Evidence the server lists, in words. Only what `describeEvidence` already prints for this viewer (no payload key is ever dumped). */
export function evidenceView(e: OwnerEvidenceRow) {
  // The owner endpoint does not send a snapshot version; the legacy page passes 0 the same way.
  return describeEvidence({ ...e, snapshotVersion: 0 } as unknown as GymEvidence);
}

export function moreInfoText(info: PartyMoreInfo | null | undefined): { who: string; due: string } | null {
  if (!info) return null;
  const parties = info.askedParties ?? [];
  const who = parties.map((p) => (p === "GYM" ? "Phòng tập của bạn" : "Hội viên")).join(" và ");
  return { who, due: info.dueAt ? stamp(info.dueAt) : "" };
}

export function caseTimeline(d: OwnerCaseDetail): CaseTimelineItem[] {
  const items: CaseTimelineItem[] = [];
  items.push({ key: "opened", at: d.case.createdAt, title: "Hồ sơ khiếu nại được mở", text: issueLabel(d.complaint.issueType), done: true });
  if (d.moreInfo) items.push({ key: "more", at: d.moreInfo.askedAt, title: "Gymini yêu cầu phòng tập bổ sung", text: d.moreInfo.dueAt ? `Hạn phản hồi ${stamp(d.moreInfo.dueAt)}` : undefined, done: true });
  for (const e of d.evidence ?? []) {
    items.push({ key: `e-${e.id}`, at: e.capturedAt, title: e.mine ? "Phòng tập khai báo bằng chứng" : evidenceView(e).title, done: true });
  }
  for (const s of d.statements ?? []) {
    items.push({ key: `s-${s.id}`, at: s.createdAt, title: s.mine ? "Phòng tập gửi giải trình" : "Nội dung được chia sẻ với phòng tập", done: true });
  }
  items.sort((a, b) => (a.at ? new Date(a.at).getTime() : Infinity) - (b.at ? new Date(b.at).getTime() : Infinity));
  items.push({ key: "now", at: null, title: "Tiến độ hiện tại", text: d.case.progress, done: false });
  return items;
}

export const RESULT_NOTE =
  "Quyết định, kháng nghị và hoàn tiền do Gymini xử lý. Phòng tập không có thao tác nào cho các bước này. Câu tiến độ ở trên là câu do máy chủ gửi.";
export const IDENTITY_NOTE = "Danh tính hội viên được giữ kín. Mã sha256 của tài liệu chỉ là thông tin người nộp tự khai, chưa được kiểm chứng.";
export const CLOSED_NOTE = "Hồ sơ hiện không nhận thêm giải trình hay tài liệu.";

// ----------------------------------------------------------------------------------------------------------------------- errors
export interface CaseProblem {
  kind: "auth" | "forbidden" | "notFound" | "conflict" | "network" | "server";
  title: string;
  body: string;
  retry: boolean;
}

/** One Vietnamese sentence per HTTP answer of the read: 403 / 404 / 409 / 5xx / no answer. The server's code is never shown. */
export function caseProblem(error: unknown, what: "list" | "detail"): CaseProblem {
  const v = parseGymError(error, { action: "read" });
  const status = v.status;
  if (v.kind === "auth" || status === 401) return { kind: "auth", title: "Phiên đăng nhập đã hết hạn", body: "Hãy đăng nhập lại để tiếp tục.", retry: false };
  if (status === 403 || v.kind === "forbidden") {
    return what === "list"
      ? { kind: "forbidden", title: "Bạn không xem được khiếu nại", body: "Chỉ chủ phòng tập và quản lý của chi nhánh có hồ sơ mới xem được khiếu nại. Chưa kết luận chi nhánh nào có hay không có khiếu nại.", retry: false }
      : { kind: "forbidden", title: "Bạn không xem được hồ sơ này", body: "Hồ sơ thuộc chi nhánh ngoài phạm vi của tài khoản này, hoặc vai trò của bạn không được xem khiếu nại. Quay lại danh sách để mở hồ sơ khác.", retry: false };
  }
  if (status === 404 || v.kind === "notFound") return { kind: "notFound", title: "Không tìm thấy hồ sơ", body: "Hồ sơ không tồn tại hoặc không còn thuộc phòng tập của bạn. Quay lại danh sách để chọn lại.", retry: false };
  if (status === 409 || v.kind === "blocked" || v.kind === "conflictReload") return { kind: "conflict", title: "Hồ sơ vừa thay đổi", body: `${v.message} Hãy tải lại để xem bước hiện tại.`, retry: true };
  if (v.kind === "network") return { kind: "network", title: "Chưa kết nối được máy chủ", body: "Kiểm tra mạng rồi thử lại. Chưa kết luận gì về hồ sơ.", retry: true };
  return { kind: "server", title: what === "list" ? "Chưa tải được danh sách khiếu nại" : "Chưa tải được hồ sơ", body: "Máy chủ gặp lỗi khi tải. Chưa kết luận có hay không có hồ sơ. Hãy thử lại.", retry: true };
}

// ----------------------------------------------------------------------------------------------------------------------- unsaved typing
/**
 * The two legacy forms (`GymStatementForm`, `GymDocumentForm`) keep their own state and are wrapped untouched, so "is anything typed?" is
 * read from the controls they render: any text box or text area with something in it. Read at the moment of leaving, never cached.
 */
export function hasTypedContent(root: ParentNode | null | undefined): boolean {
  if (!root) return false;
  const boxes = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=button]):not([type=submit])");
  for (const b of Array.from(boxes)) if ((b.value ?? "").trim() !== "") return true;
  return false;
}

/** Leaving with something typed asks: another page, another case, or another branch in the strip. Opening the same case again does not. */
export function shouldAskBeforeLeaving(p: { dirty: boolean; from: { pathname: string; search: string }; to: { pathname: string; search: string } }): boolean {
  if (!p.dirty) return false;
  if (p.from.pathname.replace(/\/$/, "") !== p.to.pathname.replace(/\/$/, "")) return true;
  const fa = new URLSearchParams(p.from.search);
  const ta = new URLSearchParams(p.to.search);
  return fa.get("gymId") !== ta.get("gymId");
}
