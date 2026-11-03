/**
 * D4 / M12 - party-side (client / PT) wording of the Dispute Case screens.
 *
 * The D1 labels are written for the admin who investigates ("Chờ các bên phản hồi", "Cần một quản trị viên khác duyệt (bốn mắt)",
 * "Trừ 1 quyền buổi ..."). A party must not read admin process words, outcomes or promises, so this file has its own Record per enum.
 * Every table is a `Record<Union, string>` so the compiler (and the exhaustive test) fails when an enum gains a value.
 *
 * Content rules kept here (handoff section 10 + M12 + R-12):
 *  - nothing says the other side was notified, answered or submitted anything; nothing says a notification will arrive;
 *  - no outcome of a ruling is promised or described (DQ-2(a) is a result, never a promise to a party; never "buổi tập không bị trừ");
 *  - "Đã duyệt" is not "đã thực hiện", and neither is "tiền đã về";
 *  - no internal id / enum / abbreviation (D77, B-1 ...) reaches the user.
 */
import type { CaseStatus, CaseType, PartyRole, ProvenanceType } from "../admin/disputes/disputeCaseTypes";

export const PARTY_STATUS_LABEL: Record<CaseStatus, string> = {
  INTAKE: "Vừa được tiếp nhận",
  COLLECTING: "Đang thu thập thông tin",
  AWAITING_PARTIES: "Đang chờ thêm thông tin",
  ASSESSING: "Đang được xem xét",
  TECH_RECONCILIATION: "Đang đối chiếu dữ liệu kỹ thuật",
  FINDING_RECORDED: "Đang chuẩn bị đề xuất xử lý",
  POLICY_PENDING: "Đang chờ xác định chính sách áp dụng",
  PROPOSED: "Đang chuẩn bị đề xuất xử lý",
  AWAITING_APPROVAL: "Đề xuất xử lý đang chờ phê duyệt",
  DECISION_APPROVED: "Đã có quyết định",
  REJECTED_INTAKE: "Hồ sơ không được tiếp nhận",
};

/** One line under the status: what the file is doing now. Never an outcome, never a date promise. */
export const PARTY_STATUS_NOTE: Record<CaseStatus, string> = {
  INTAKE: "Hồ sơ đã được ghi nhận và đang chờ quản trị viên tiếp nhận.",
  COLLECTING: "Quản trị viên đang thu thập thông tin cho hồ sơ này.",
  AWAITING_PARTIES: "Hồ sơ đang chờ thêm thông tin từ các bên.",
  ASSESSING: "Quản trị viên đang xem xét những thông tin đã có.",
  TECH_RECONCILIATION: "Quản trị viên đang đối chiếu dữ liệu kỹ thuật của buổi tập.",
  FINDING_RECORDED: "Hồ sơ đang ở bước chuẩn bị đề xuất xử lý.",
  POLICY_PENDING: "Hồ sơ đang chờ xác định chính sách áp dụng cho trường hợp này.",
  PROPOSED: "Hồ sơ đang ở bước chuẩn bị đề xuất xử lý.",
  AWAITING_APPROVAL: "Đề xuất xử lý đang chờ một quản trị viên khác phê duyệt.",
  DECISION_APPROVED:
    "Hồ sơ đã có quyết định. Quyết định được duyệt chưa có nghĩa là mọi bước đã được thực hiện hoặc tiền đã về; xem mục «Tiền» bên dưới.",
  REJECTED_INTAKE: "Hồ sơ không được tiếp nhận.",
};

export const PARTY_TYPE_LABEL: Record<CaseType, string> = {
  PT_DELIVERY: "Khiếu nại về báo cáo hoàn thành buổi tập",
  PT_CLIENT_NO_SHOW_CLAIM: "PT báo khách vắng mặt, khách phản đối",
  PT_NO_SHOW_CLAIM: "Khách báo PT vắng mặt, PT phản đối",
  LEGACY_UNCLASSIFIED: "Khiếu nại về buổi tập",
};

export const PARTY_ROLE_LABEL: Record<"CLIENT" | "PT", string> = {
  CLIENT: "Khách hàng",
  PT: "Huấn luyện viên (PT)",
};

export const CLAIMANT_LABEL: Record<"CLIENT" | "PT" | "SYSTEM", string> = {
  CLIENT: "Khách hàng nêu",
  PT: "PT nêu",
  SYSTEM: "Hệ thống ghi nhận",
};

export const CLAIM_MOVE_PARTY_LABEL: Record<"MONEY" | "QUOTA" | "PT_AT_FAULT", string> = {
  MONEY: "tiền",
  QUOTA: "quyền buổi tập",
  PT_AT_FAULT: "lỗi của PT",
};

export const STATEMENT_SOURCE_LABEL: Record<string, string> = {
  SUBMITTED: "Gửi qua ứng dụng",
  LEGACY_FIELD: "Ghi nhận từ lúc khiếu nại ban đầu",
};

/** Where a row of evidence comes from, in the words of a party (the D1 table says "Máy chủ ..." and "Quản trị viên nhận hộ" for admins). */
export const PARTY_PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  SERVER_OBSERVED: "Hệ thống ghi nhận trực tiếp",
  USER_REPORTED_STORED: "Do người dùng tự khai, hệ thống chỉ lưu lại",
  DERIVED: "Tính từ dữ liệu khác, không phải nguồn độc lập",
  EXTERNAL_DOCUMENT: "Tài liệu ngoài hệ thống",
  TECH_GAP: "Không đọc được nguồn",
  NOT_APPLICABLE: "Không áp dụng",
  ADMIN_RECEIVED_ON_BEHALF: "Quản trị viên nhận hộ",
  LEGACY_FIELD: "Thông tin ghi từ lúc khiếu nại ban đầu",
  SELF_REPORTED_SERVER_RECORDED: "Người dùng tự quét hoặc tự khai, hệ thống chỉ ghi lại",
  STAFF_ATTESTED_SERVER_RECORDED: "Nhân viên phòng tập check-in hộ và tự xác nhận danh tính",
};
export const partyProvenanceLabel = (s: unknown) => (typeof s === "string" && Object.prototype.hasOwnProperty.call(PARTY_PROVENANCE_LABEL, s) ? PARTY_PROVENANCE_LABEL[s as ProvenanceType] : "Nguồn chưa rõ");

export const NOT_FOUND_TITLE = "Không tìm thấy hồ sơ";
export const NOT_FOUND_TEXT = "Hồ sơ này không có trong danh sách của bạn hoặc đường dẫn chưa đúng. Hãy quay lại danh sách để chọn lại.";

export const CAN_SUBMIT_NOTE = "Bạn có thể gửi lời khai và tài liệu của mình cho hồ sơ này.";
export const CANNOT_SUBMIT_NOTE = "Ở bước này hồ sơ chưa nhận thêm lời khai hay tài liệu từ bạn. Hãy quay lại xem sau.";
export const NO_AUTO_REFRESH_NOTE = "Trang này không tự cập nhật. Bấm «Tải lại» để xem thay đổi mới nhất.";
export const VISIBLE_ONLY_NOTE = "Danh sách này chỉ gồm những mục bạn được phép xem.";

export const MONEY_STATUS_NOTE =
  "Đây là trạng thái ghi nhận của khoản tiền liên quan đến buổi này, không phải xác nhận tiền đã về ví hay tài khoản của bạn. Màn này không hiển thị số tiền.";

export const NO_FILE_NOTE = "Gymini không nhận tệp ở bước này: chỉ phần mô tả và mã sha256 do bạn khai được lưu lại. Không có tệp nào được tải lên.";
export const OWN_DOC_UNVERIFIED = "Bạn tự khai, chưa được xác minh";
export const MINE_LABEL = "Của bạn";
export const SHARED_LABEL = "Được chia sẻ cho bạn";
export const ROLE_RECORDED_LABEL = "Ghi nhận cho vai trò của bạn";
export const UNREADABLE_SOURCE = "Không đọc được nguồn. Đây không phải bằng chứng về việc vắng mặt.";

const lookup = <K extends string>(table: Record<K, string>, key: unknown, fallback: string): string =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key as K] : fallback;

export const partyStatusLabel = (s: unknown) => lookup(PARTY_STATUS_LABEL, s, "Đang được xử lý");
export const partyStatusNote = (s: unknown) => lookup(PARTY_STATUS_NOTE, s, "Hồ sơ đang được xử lý.");
export const partyTypeLabel = (s: unknown) => lookup(PARTY_TYPE_LABEL, s, "Khiếu nại về buổi tập");
export const partyRoleLabel = (s: unknown) => lookup(PARTY_ROLE_LABEL, s, "Chưa rõ vai trò");
export const claimantLabel = (s: unknown) => lookup(CLAIMANT_LABEL, s, "Bên khác nêu");
export const claimMoveLabel = (s: unknown) => lookup(CLAIM_MOVE_PARTY_LABEL, s, "nội dung khác");
export const statementSourceLabel = (s: unknown): string | null =>
  typeof s === "string" && Object.prototype.hasOwnProperty.call(STATEMENT_SOURCE_LABEL, s) ? STATEMENT_SOURCE_LABEL[s] : null;

export type PartyViewRole = Extract<PartyRole, "CLIENT" | "PT">;
