/**
 * What an applicant is told when an admin acts on their PT application. The status screen has
 * always promised "Bạn sẽ nhận thông báo khi có kết quả", but only the ADMIN side was ever
 * notified (on submit) — an approved applicant heard nothing and had to reopen the app to find
 * out (real phone, 7/10). UNDER_REVIEW is an internal queue move, not a result: no notice.
 */
export type PtApplicationNotice = { text: string; link: string };

const APPLICANT_LINK = "/client/pt-application";

export function ptApplicationReviewNotice(action: string): PtApplicationNotice | null {
  switch (action) {
    case "APPROVED":
      return {
        text: "Đơn ứng tuyển huấn luyện viên của bạn đã được duyệt. Mở lại ứng dụng để vào không gian Huấn luyện viên.",
        link: APPLICANT_LINK,
      };
    case "REJECTED":
      return {
        text: "Đơn ứng tuyển huấn luyện viên của bạn chưa được chấp nhận. Mở đơn để xem lý do.",
        link: APPLICANT_LINK,
      };
    case "NEEDS_MORE_INFO":
      return {
        text: "Đơn ứng tuyển huấn luyện viên của bạn cần bổ sung thông tin. Mở đơn để xem yêu cầu.",
        link: APPLICANT_LINK,
      };
    default:
      return null;
  }
}
