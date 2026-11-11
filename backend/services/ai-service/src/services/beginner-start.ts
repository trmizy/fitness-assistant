/**
 * "Tôi mới đăng ký, chưa biết tập gì — nên bắt đầu từ đâu?" — the first thing a brand-new user asks. Found by the persona journey
 * evaluation: it was routed to the "today's saved schedule" reader and answered "Mình chưa thấy lịch tập cụ thể được lưu…".
 *
 * A deterministic, profile-aware starter answer: it names the four real next steps the app offers (roadmap, schedule, nutrition, a PT)
 * with the exact phrasing that routes to each, and promises nothing it cannot do. No model: nothing can be invented.
 */
import { normalizeAgentText } from "./fitness-agent-intent";

// A newcomer marker AND an ask-for-direction marker, in a short message ("chưa biết tập gì", "mới đăng ký… nên bắt đầu từ đâu").
const NEWCOMER = /\b(moi dang ky|moi tham gia|moi bat dau|moi tap|moi vao|nguoi moi|lan dau (?:di )?tap|chua (?:tung|biet) tap|chua biet (?:phai )?(?:tap )?(?:gi|bat dau|lam gi)|chua co kinh nghiem|chua tap bao gio|khong biet (?:phai )?(?:bat dau|tap) (?:tu )?(?:gi|dau)|bat dau tu dau)\b/;
const ASK = /\b(bat dau|nen lam gi|nen tap gi|tap gi|lam gi|tu dau|huong dan|goi y|tu van|nhu the nao|the nao|chuan bi|can gi)\b/;
// An explicit concrete request is handled by its own flow, not by this overview.
const CONCRETE = /\b(tao|lap|len|doi|sua|xoa|luu) (?:cho toi )?(?:lich|lo trinh|thuc don|ke hoach|plan|roadmap)\b/;

export function isBeginnerStartQuestion(rawText: string): boolean {
  if (!/[a-z]/i.test(rawText)) return false;
  const s = normalizeAgentText(rawText);
  if (s.split(" ").length > 40) return false;
  return NEWCOMER.test(s) && ASK.test(s) && !CONCRETE.test(s);
}

const GOALS: Record<string, string> = {
  WEIGHT_LOSS: "giảm mỡ", MUSCLE_GAIN: "tăng cơ", MAINTENANCE: "duy trì thể trạng", ATHLETIC_PERFORMANCE: "cải thiện thể lực", GENERAL_FITNESS: "khỏe hơn mỗi ngày",
};

export function buildBeginnerStartAnswer(profile: { goal?: string | null } | null | undefined): string {
  const goal = profile?.goal ? GOALS[profile.goal] : undefined;
  const intro = goal
    ? `Chào mừng bạn! Hồ sơ của bạn đang nhắm tới mục tiêu **${goal}**, và người mới thì không cần biết trước gì cả — mình đi từng bước nhỏ:`
    : "Chào mừng bạn! Người mới không cần biết trước gì cả — mình đi từng bước nhỏ:";
  return [
    intro,
    "",
    "1. **Lộ trình**: một kế hoạch dài hạn có mốc rõ ràng (thường 12–16 tuần cho người mới). Nhắn: “Lập lộ trình cho tôi”.",
    "2. **Lịch tập**: khởi đầu nhẹ khoảng 3 buổi/tuần, mỗi buổi 30–45 phút, bài đơn giản. Nhắn: “Tạo lịch tập cho tôi”.",
    "3. **Thực đơn**: tính theo hồ sơ của bạn. Nhắn: “Tạo thực đơn cho tôi”.",
    "4. **Người đồng hành**: nếu muốn có huấn luyện viên kèm, nhắn: “Gợi ý huấn luyện viên cho tôi” — mình sẽ so sánh theo mục tiêu và ngân sách của bạn.",
    "",
    "Muốn làm một lần cho nhanh, bạn nhắn: “Lập lộ trình và kế hoạch tập, dinh dưỡng cho tôi”. Mình sẽ cho bạn xem bản nháp trước, **chỉ lưu khi bạn xác nhận**.",
    "Bạn cũng có thể hỏi thẳng, ví dụ “Buổi tập đầu tiên nên làm gì?” hoặc “Tập ở nhà không có dụng cụ được không?”.",
  ].join("\n");
}
