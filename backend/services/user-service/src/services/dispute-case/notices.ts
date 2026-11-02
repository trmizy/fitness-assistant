import { logger } from "@gym-coach/shared";
import { notificationService } from "../notification.service";

/**
 * Backend completion: in-app notices of a case's lifecycle, told to the two parties and to the assigned admin through the existing notificationService.
 *
 * Wording rules: Vietnamese, no internal enum or id, and NEVER a claim that money was paid or refunded (only the ledger can say that; the case's financial view
 * is where it is read). A notice that must be sure not to promise anything says what is true at that moment: "chờ", "đã ghi nhận", "chưa có thay đổi".
 *
 * Sent AFTER the transaction that made the change committed (best-effort, a failure is logged and never fails the case operation). An idempotent replay
 * sends nothing again (the replay returns the stored answer without running the operation).
 */
export type NoticeKind =
  | "OPENED"
  | "ASSIGNED"
  | "EVIDENCE_REQUESTED"
  | "FINDING_RECORDED"
  | "AWAITING_APPROVAL"
  | "DECISION_APPROVED"
  | "DECISION_REJECTED"
  | "EXECUTED"
  | "EXEC_BLOCKED"
  | "NEEDS_HUMAN"
  | "CLOSED";

export interface CaseParties {
  id: string;
  clientUserId: string;
  ptUserId: string;
  investigatorId?: string | null;
}

export interface Notice {
  userId: string;
  text: string;
  link: string;
}
export interface NoticeSet {
  caseId: string;
  notices: Notice[];
  /** realtime only (not stored): every connected admin */
  adminBroadcast?: { text: string };
}

/** Why an approved decision could not be carried out yet, in words (the machine code is in the case detail). */
export function blockReasonVi(code: string | null | undefined): string {
  switch (code) {
    case "PT_NO_SHOW_REPORTED_NOT_SUPPORTED":
      return "buổi tập đang chờ huấn luyện viên phản hồi báo vắng mặt";
    case "CONTRACT_ENDING":
      return "hợp đồng đang được kết thúc và khoản tiền chưa được xác nhận";
    case "LEDGER_UNREADABLE":
      return "chưa đọc được sổ cái thanh toán";
    case "D77_COMBINATION_UNRESOLVED":
    case "CANCELLED_BLOCKED_BY_D77":
      return "buổi tập có khoản đền đến muộn cần được đối soát trước";
    case "POLICY_ELIGIBILITY_UNVERIFIED":
    case "POLICY_EXCEPTION_APPLIES":
      return "hợp đồng chưa có kết luận chính sách đã được duyệt";
    case "EXECUTION_DISABLED":
      return "chức năng thực thi quyết định chưa được bật";
    default:
      return "cần người xem xét thêm";
  }
}

const CLIENT_LINK = "/client/booking";
const PT_LINK = "/pt/schedule";
const ADMIN_LINK = "/admin/disputes";

const parties = (c: CaseParties, text: string): Notice[] => [
  { userId: c.clientUserId, text, link: CLIENT_LINK },
  { userId: c.ptUserId, text, link: PT_LINK },
];
const investigator = (c: CaseParties, text: string, exceptUserId?: string): Notice[] =>
  c.investigatorId && c.investigatorId !== exceptUserId ? [{ userId: c.investigatorId, text, link: ADMIN_LINK }] : [];

export function noticesFor(kind: NoticeKind, c: CaseParties, o: { actorId?: string; reasonCode?: string | null; assigneeId?: string } = {}): NoticeSet {
  const set = (notices: Notice[], adminBroadcast?: { text: string }): NoticeSet => ({ caseId: c.id, notices, ...(adminBroadcast ? { adminBroadcast } : {}) });
  switch (kind) {
    case "OPENED":
      return set(parties(c, "Hồ sơ khiếu nại về buổi tập của bạn đã được mở. Quản trị viên sẽ xem xét và có thể nhờ bạn bổ sung lời khai hoặc bằng chứng."));
    case "ASSIGNED": {
      const to = o.assigneeId ?? c.investigatorId;
      return set(to && to !== o.actorId ? [{ userId: to, text: "Bạn được giao xử lý một hồ sơ khiếu nại buổi tập.", link: ADMIN_LINK }] : []);
    }
    case "EVIDENCE_REQUESTED":
      return set(parties(c, "Quản trị viên đề nghị bạn bổ sung lời khai hoặc bằng chứng cho hồ sơ khiếu nại buổi tập. Vui lòng gửi trong hồ sơ."));
    case "FINDING_RECORDED":
      return set(parties(c, "Quản trị viên đã ghi nhận kết quả điều tra của hồ sơ khiếu nại. Hồ sơ chuyển sang bước đề xuất và duyệt; chưa có quyết định nào."));
    case "AWAITING_APPROVAL":
      return set([], { text: "Có hồ sơ khiếu nại đang chờ một quản trị viên khác duyệt." });
    case "DECISION_APPROVED":
      return set([
        ...parties(c, "Hồ sơ khiếu nại đã có quyết định được duyệt và đang chờ thực thi. Bạn sẽ được báo khi buổi tập được cập nhật."),
        ...investigator(c, "Đề xuất của bạn trong hồ sơ khiếu nại đã được duyệt. Quyết định đang chờ thực thi.", o.actorId),
      ]);
    case "DECISION_REJECTED":
      return set(investigator(c, "Đề xuất của bạn trong hồ sơ khiếu nại bị từ chối; hồ sơ quay lại bước đánh giá.", o.actorId));
    case "EXECUTED":
      return set([
        ...parties(c, "Buổi tập trong hồ sơ khiếu nại đã được cập nhật theo quyết định. Việc ghi sổ tiền, nếu có, được hiển thị riêng ở ví và có thể đến sau."),
        ...investigator(c, "Quyết định đã được thực thi trên buổi tập. Trạng thái tiền xem ở mục tài chính của hồ sơ.", o.actorId),
      ]);
    case "EXEC_BLOCKED":
      return set([
        ...parties(c, "Quyết định của hồ sơ khiếu nại đang tạm chờ, chưa có thay đổi nào ở buổi tập."),
        ...investigator(c, `Quyết định đã duyệt chưa thực thi được: ${blockReasonVi(o.reasonCode)}. Chưa có thay đổi nào ở buổi tập hay tiền.`, o.actorId),
      ]);
    case "NEEDS_HUMAN":
      return set(investigator(c, "Việc thực thi quyết định của một hồ sơ khiếu nại cần người xem xét: trạng thái buổi tập và quyết định không khớp nhau.", o.actorId));
    case "CLOSED":
      return set(parties(c, "Hồ sơ khiếu nại đã được đóng mà không có quyết định nào về buổi tập hay tiền."));
  }
}

/** Best-effort, after commit. Never throws. */
export async function sendNotices(sets: NoticeSet[]): Promise<void> {
  for (const s of sets) {
    for (const n of s.notices) {
      try {
        await notificationService.create({ userId: n.userId, text: n.text, eventType: "DISPUTE_CASE_UPDATED", entityType: "DISPUTE_CASE", entityId: s.caseId, link: n.link });
      } catch (e) {
        logger.warn({ caseId: s.caseId, message: (e as Error)?.message?.slice(0, 200) }, "Dispute case notice not stored");
      }
    }
    if (s.adminBroadcast) {
      try {
        notificationService.broadcastToAdmins({
          id: `dispute-case-${s.caseId}`,
          text: s.adminBroadcast.text,
          eventType: "DISPUTE_CASE_UPDATED",
          entityType: "DISPUTE_CASE",
          entityId: s.caseId,
          link: ADMIN_LINK,
        });
      } catch {
        /* realtime only */
      }
    }
  }
}
