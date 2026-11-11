/**
 * The call screens (web and mobile) show `call:error` / REST `error` text to the user, so it has to be
 * Vietnamese. The service layer keeps its English strings as internal codes (tests and the controller's
 * HTTP-status mapping match on them); this table turns them into user text at the boundary.
 *
 * Join-token messages are deliberately NOT translated: both clients recognise them by the words
 * "token"/"join" and show their own "bấm tham gia lại" text.
 */
const CALL_ERROR_VI: Record<string, string> = {
  "Missing required fields": "Thiếu thông tin để thực hiện cuộc gọi",
  "Invalid call type": "Loại cuộc gọi không hợp lệ, chỉ hỗ trợ gọi thoại hoặc gọi video",
  "callType must be 'VOICE' or 'VIDEO'": "Loại cuộc gọi không hợp lệ, chỉ hỗ trợ gọi thoại hoặc gọi video",
  "receiverId is required": "Thiếu người nhận cuộc gọi",
  "coachingSessionId is required for session-origin calls": "Thiếu mã buổi tập cho cuộc gọi buổi tập",
  "No conversation between caller and receiver": "Chưa có cuộc trò chuyện giữa hai người",
  "Both users must be participants of this conversation": "Cả hai người phải thuộc cuộc trò chuyện này",
  "One or both accounts are deactivated": "Một trong hai tài khoản đang bị vô hiệu hóa",
  "Cannot verify account status right now": "Chưa kiểm tra được trạng thái tài khoản, vui lòng thử lại sau",
  "Session not found": "Không tìm thấy buổi tập",
  "Session is not confirmed": "Buổi tập chưa được xác nhận",
  "Session mode must be ONLINE or HYBRID": "Buổi tập này không diễn ra trực tuyến",
  "You are not a participant of this session": "Bạn không thuộc buổi tập này",
  "Outside the call time window for this session": "Chưa đến hoặc đã quá giờ gọi của buổi tập này",
  "Failed to verify session": "Không xác minh được buổi tập, vui lòng thử lại",
  "Not allowed": "Bạn không được phép thực hiện cuộc gọi này",
  "You are already in a call": "Bạn đang trong một cuộc gọi khác",
  "User is busy": "Người kia đang bận",
  "Call not found": "Không tìm thấy cuộc gọi",
  "Not authorized": "Bạn không có quyền thực hiện thao tác này",
  "Call is no longer ringing": "Cuộc gọi không còn đổ chuông",
  "Call cannot be cancelled in current state": "Không thể huỷ cuộc gọi ở trạng thái hiện tại",
  "Call is not in an active state": "Cuộc gọi chưa ở trạng thái đang diễn ra",
  "No active grace period for this call": "Cuộc gọi này không còn trong thời gian kết nối lại",
  "Failed to initiate call": "Không bắt đầu được cuộc gọi, vui lòng thử lại",
  "Failed to create call": "Không bắt đầu được cuộc gọi, vui lòng thử lại",
  "Failed to accept call": "Không nhận được cuộc gọi, vui lòng thử lại",
  "Failed to reject call": "Không từ chối được cuộc gọi, vui lòng thử lại",
  "Failed to cancel call": "Không huỷ được cuộc gọi, vui lòng thử lại",
  "Failed to end call": "Không kết thúc được cuộc gọi, vui lòng thử lại",
  Unauthorized: "Phiên đăng nhập không hợp lệ",
};

/** Vietnamese text for a call error; anything unknown (incl. join-token errors) is returned unchanged. */
export function callErrorText(message: string | undefined): string {
  if (!message) return "Cuộc gọi gặp lỗi, vui lòng thử lại";
  return CALL_ERROR_VI[message] ?? message;
}

export const VALID_CALL_TYPES = ["VOICE", "VIDEO"] as const;
