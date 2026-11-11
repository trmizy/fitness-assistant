/**
 * What a user may read about a failed/skipped step of a confirmed plan bundle. Reviewer feedback (persona playground v2): the result card showed
 * raw backend text ("An active legacy cycle already exists; close it before activating a roadmap phase", "already_initialized") — internal
 * wording and English. Known cases get a plain-Vietnamese explanation with the next step; anything else English-only becomes a neutral retry hint.
 */
const HAS_VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export function friendlyStepDetail(step: "roadmap" | "workout" | "nutrition", detail: string | undefined | null): string | undefined {
  if (!detail) return undefined;
  const d = detail.trim();
  if (/active legacy cycle already exists/i.test(d)) {
    return "Bạn đang có một chu kỳ tập cũ còn hoạt động nên chưa bắt đầu lộ trình mới được. Hãy kết thúc chu kỳ đó rồi bấm Xác nhận lại để tạo lộ trình (các phần đã tạo không bị tạo lại).";
  }
  if (/already_initialized/i.test(d)) return "đã có sẵn từ trước, không cần tạo lại";
  // Roadmap activation 409s (fitness-roadmap.service activateRoadmap/activatePhase) — 2026-11-09 these surfaced as "lỗi tạm thời,
  // thử lại sau", but no retry can fix them.
  if (/another roadmap is already active/i.test(d)) {
    return "Bạn đang có một lộ trình khác đang hoạt động, nên lộ trình mới chưa được kích hoạt (đã lưu dạng nháp). Vào trang Lộ trình để kết thúc hoặc lưu trữ lộ trình cũ, rồi bấm Xác nhận lại — các phần đã tạo không bị tạo lại.";
  }
  if (/another phase is already active|active cycle already belongs to another roadmap phase/i.test(d)) {
    return "Bạn đang có một giai đoạn/chu kỳ tập khác còn hoạt động, nên lộ trình mới chưa kích hoạt được. Hãy kết thúc chu kỳ đó ở trang Lộ trình rồi bấm Xác nhận lại.";
  }
  if (/roadmap has no phase to activate/i.test(d)) return "Bản nháp lộ trình không có giai đoạn nào để bắt đầu — hãy nhắn “tạo lộ trình mới” để mình lập lại.";
  if (/roadmap is archived/i.test(d)) return "Lộ trình này đã được lưu trữ — hãy nhắn “tạo lộ trình mới” để mình lập lộ trình khác.";
  if (step === "workout" && /Không có chương trình tập phù hợp/i.test(d)) {
    return "chưa có chương trình mẫu nào khớp trong thư viện — bạn nhắn “Tạo lịch tập cho tôi” để mình tạo lịch riêng cho bạn.";
  }
  if (!HAS_VIETNAMESE.test(d) && /[a-z]{4,}/i.test(d) && !/^(ok|done)$/i.test(d)) {
    return "hệ thống chưa tạo được phần này (lỗi tạm thời) — bạn thử xác nhận lại sau ít phút.";
  }
  return d;
}
