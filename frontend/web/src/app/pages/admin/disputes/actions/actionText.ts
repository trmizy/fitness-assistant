/**
 * D3 - fixed Vietnamese wording of the Case Workspace write forms (handoff sections 3 and 4). No React.
 * Rules kept here: business language only (no D77 / B-1 / enum names), the confirmation sentences are the ones of handoff section 4,
 * and nothing here promises an execution, a refund or a payout.
 */

export const CONFIRM_APPROVE = "Sau khi duyệt, hồ sơ không thể sửa hay huỷ duyệt.";
export const CONFIRM_REJECT_PROPOSAL = "Hồ sơ quay lại bước đánh giá.";
export const CONFIRM_REJECT_INTAKE = "Hồ sơ đóng vĩnh viễn.";
export const CONFIRM_SHARE = "Không thể thu hồi.";
export const CONFIRM_ASSIGN = "Người nhận sẽ có quyền làm mọi bước điều tra.";

/** Shown after an approval went through: approval is not execution, and the execution state is not readable. */
export const APPROVED_DONE = "Đã duyệt. Chưa đọc được trạng thái thực thi.";
export const APPROVED_DONE_HELP = "Duyệt chưa làm thay đổi buổi tập, quyền buổi hay tiền. Xem tab Thực thi.";
export const REJECTED_DONE = "Đã bác đề xuất. Hồ sơ quay lại bước «Đang đánh giá».";

export const COI_LABEL = "Tôi khai báo không có xung đột lợi ích với vụ việc này.";
export const COI_HELP = "Bắt buộc phải tích để gửi. Người duyệt không được là người lập đề xuất, điều tra viên, khách hay PT của buổi.";
export const EVIDENCE_ACK_LABEL = "Tôi đã xem thay đổi bằng chứng mà điều tra viên đã xác nhận.";

export const RECOLLECT_FIRST_NOTE =
  "Nguồn bằng chứng đã đổi nhưng chưa được thu lại. Việc này không thể xác nhận cho qua: điều tra viên cần bấm «Thu lại bằng chứng» ở tab Bằng chứng, rồi người duyệt tải lại hồ sơ.";
export const ACK_THEN_TICK_NOTE =
  "Bằng chứng đã thay đổi sau khi lập đề xuất. Điều tra viên cần ghi «Xác nhận thay đổi bằng chứng» ở tab Bằng chứng. Sau đó tải lại hồ sơ, tích ô xác nhận bên dưới và gửi lại.";

export const NOT_INVESTIGATOR_PREFIX = "Chỉ điều tra viên được giao hồ sơ này mới làm được thao tác này";
export const NO_INVESTIGATOR_LINE = "Hồ sơ chưa có người phụ trách nên chưa ai làm được các thao tác điều tra. Hãy nhận hồ sơ hoặc giao cho một quản trị viên ở mục «Giao người phụ trách».";
export const TERMINAL_LINE = "Hồ sơ đã ở trạng thái cuối nên không còn thao tác nào.";

export const CANNOT_APPROVE_PROPOSER = "Bạn là người lập đề xuất này nên không duyệt được. Cần một quản trị viên khác.";
export const CANNOT_APPROVE_INVESTIGATOR = "Bạn là điều tra viên của hồ sơ này nên không duyệt được. Cần một quản trị viên khác.";
export const APPROVER_PARTY_UNKNOWN_NOTE =
  "Màn này chưa biết khách và PT của buổi là ai nên không tự kiểm được xung đột lợi ích. Nếu bạn là một bên của vụ việc, máy chủ sẽ từ chối và nói rõ lý do.";

export const SHARE_NONE_ELIGIBLE =
  "Chưa có bằng chứng nào chia sẻ được. Bằng chứng do chính một bên nộp, chưa được máy chủ xác minh, hoặc nhạy cảm/hạn chế thì không bao giờ chia sẻ cho bên kia.";
export const SHARE_STATEMENT_NONE = "Hồ sơ chưa có lời khai nào để chia sẻ.";

export const PROPOSE_NOT_A_DISPUTE = "Kết luận «Không phải khiếu nại» chưa có thiết kế xử lý nên chưa lập được đề xuất.";
export const PROPOSE_DONE = "Đã lập đề xuất. Hồ sơ chờ một quản trị viên khác duyệt.";
export const PROPOSE_ONLY_NOTE = "Đề xuất không có ô kết quả hay số tiền: máy chủ tự tính từ kết luận.";

export const CLASSIFY_NOTE = "Phân loại xong không đổi lại được. Hồ sơ phân loại tạm chưa ghi được kết luận hay đề xuất.";
export const ASSIGN_NOTE = "Chỉ chọn được quản trị viên có trong danh sách. Hồ sơ chuyển cho người nhận ngay, kể cả khi đang có người khác phụ trách.";
export const ASSIGN_LIST_FAILED = "Chưa lấy được danh sách quản trị viên.";
export const ASSIGN_LIST_EMPTY = "Không có quản trị viên nào khác đang hoạt động trong danh sách.";

export const FINDING_PREREQ_NOTE = "Mỗi khẳng định trong hồ sơ phải được đánh giá trước khi ghi kết luận (trừ kết luận «Không phải khiếu nại»).";
export const GROUPS_NOTE = "Mỗi bằng chứng chỉ xếp vào một nhóm. Chọn «Không dùng» nếu bằng chứng không liên quan đến khẳng định này.";

export const FIELD_FALLBACK = "Nội dung chưa hợp lệ.";
export const REQUIRED = "Cần nhập nội dung.";
export const tooLong = (max: number, n: number) => `Tối đa ${max} ký tự (đang có ${n}).`;
