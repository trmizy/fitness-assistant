/**
 * Cảnh báo của AI trên trang kế hoạch.
 *
 * Worker AI ghi vào `_metadata.aiWarnings` cả chuỗi lẫn OBJECT có cấu trúc (kết quả kiểm định kế hoạch, các lần tự sửa nội bộ...).
 * Trước đây trang in thẳng JSON.stringify(object) nên người dùng thấy `{"type":"coach_plan_validation","errors":[]...}` bằng tiếng
 * Anh. Ở đây: mã cảnh báo đã biết -> câu tiếng Việt; bản ghi kỹ thuật nội bộ -> ẩn; không bao giờ in JSON thô.
 * Thuần (không phụ thuộc React/axios) để chạy dưới `npx tsx --test`.
 */

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null && !Array.isArray(v);

/** Mã kiểm định của backend (ai-service/src/coach/plan_schema.ts) -> câu người dùng đọc được. */
const VALIDATION_MESSAGES_VI: Record<string, string> = {
  beginner_volume_high: "Khối lượng tập mỗi ngày khá cao với người mới bắt đầu. Hãy theo dõi cơ thể và giảm bớt số hiệp nếu thấy quá mệt.",
  beginner_volume_too_high: "Khối lượng tập mỗi ngày quá cao với người mới bắt đầu. Nên giảm số bài hoặc số hiệp để tránh quá sức.",
  protein_outside_expected_range: "Lượng đạm (protein) trong kế hoạch nằm ngoài khoảng thường khuyến nghị. Hãy kiểm tra lại mục tiêu dinh dưỡng.",
  available_days_exceeded: "Số buổi tập trong kế hoạch nhiều hơn số ngày bạn có thể tập.",
  injury_warning_missing: "Bạn có chấn thương nên cần lưu ý an toàn: hãy tránh động tác gây đau và hỏi chuyên gia nếu cần.",
  missing_follow_up_questions: "AI còn thiếu một số thông tin về bạn. Bổ sung hồ sơ để kế hoạch sát hơn.",
  negative_calories: "Mục tiêu calo trong kế hoạch chưa hợp lệ. Hãy kiểm tra lại mục tiêu dinh dưỡng.",
};
const GENERIC_ISSUE_VI = "AI có một lưu ý về kế hoạch này. Hãy xem lại kế hoạch trước khi áp dụng.";

/** Bản ghi kỹ thuật nội bộ (tự sửa, ánh xạ tên bài...) — không có giá trị với người dùng. */
const INTERNAL_ONLY_TYPES = new Set(["deterministic_repair", "name_mapping", "muscle_mismatch_repair", "day_candidate_repair", "coach_plan_validation_fallback"]);

function issueText(issue: unknown): string | null {
  if (!isRecord(issue)) return null;
  const code = typeof issue.code === "string" ? issue.code : "";
  return VALIDATION_MESSAGES_VI[code] ?? GENERIC_ISSUE_VI;
}

/** Một phần tử của aiWarnings -> 0..n dòng hiển thị. */
export function formatPlanWarning(warning: unknown): string[] {
  if (typeof warning === "string") {
    const t = warning.trim();
    // Chuỗi trông như JSON (một phiên bản cũ đã lưu thẳng chuỗi JSON) -> parse để đi qua cùng đường dịch.
    if (t.startsWith("{") || t.startsWith("[")) {
      try { return formatPlanWarning(JSON.parse(t)); } catch { return []; }
    }
    return t ? [t] : [];
  }
  if (!isRecord(warning)) return [];
  const type = typeof warning.type === "string" ? warning.type : "";
  if (INTERNAL_ONLY_TYPES.has(type)) return [];
  if (type === "coach_plan_validation") {
    const items = [...(Array.isArray(warning.errors) ? warning.errors : []), ...(Array.isArray(warning.warnings) ? warning.warnings : [])];
    return items.map(issueText).filter((x): x is string => !!x);
  }
  // Loại không biết: không bao giờ đổ JSON ra giao diện.
  return [];
}

/** Toàn bộ danh sách hiển thị: bỏ trùng, giữ thứ tự. */
export function formatPlanWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const w of raw) for (const line of formatPlanWarning(w)) if (!out.includes(line)) out.push(line);
  return out;
}
