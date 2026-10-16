/**
 * AD-02 — hai hàng duyệt còn lại của hub "Duyệt": đơn ứng tuyển huấn luyện viên và kế hoạch tập
 * đăng lên chợ. Phần thuần.
 *
 * ĐƠN PT — luật đọc từ `user-service/pt_application.service.ts#adminReviewAction` (28/9):
 * - Hành động: UNDER_REVIEW, NEEDS_MORE_INFO (bắt buộc `adminNote`), APPROVED, REJECTED (bắt buộc
 *   `rejectionReason`).
 * - **Máy chủ KHÔNG kiểm trạng thái hiện tại** — duyệt được cả đơn nháp. Web cũng hiện đủ 4 nút ở mọi
 *   trạng thái. App tự chặn theo `ptActions(status)` để không ai duyệt nhầm một đơn chưa nộp.
 * - `adminNote` của NEEDS_MORE_INFO là câu **người nộp đọc được** (web gửi nhầm ghi chú nội bộ vào đây).
 *   App chỉ có một ô "lời nhắn cho người nộp", dùng cho cả yêu cầu bổ sung lẫn lý do từ chối.
 * - Duyệt = đổi vai trò tài khoản sang PT + bật `isPT` + tạo mã giới thiệu + tạo khu vực dạy từ đơn.
 *
 * KẾ HOẠCH TRÊN CHỢ — `/admin/ai/marketplace/plans` (lọc SUBMITTED/APPROVED/REJECTED), duyệt/từ chối
 * kèm ghi chú; mỗi kế hoạch có một bản phân tích tự động (luật + gợi ý AI) để người duyệt tham khảo —
 * **chỉ tham khảo**, quyết định vẫn là của người duyệt.
 */
export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

// ── Đơn ứng tuyển PT ──────────────────────────────────────────────────────────────────────────

export const PT_APP_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Bản nháp", tone: "neutral" },
  SUBMITTED: { label: "Mới nộp", tone: "warning" },
  UNDER_REVIEW: { label: "Đang xem xét", tone: "info" },
  NEEDS_MORE_INFO: { label: "Chờ bổ sung", tone: "info" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Đã từ chối", tone: "danger" },
};

export function ptAppStatus(s: string | null | undefined) {
  return PT_APP_STATUS[s ?? ""] ?? { label: s || "Không rõ", tone: "neutral" as StatusTone };
}

export type PtAction = "UNDER_REVIEW" | "APPROVE" | "REQUEST_INFO" | "REJECT";

/** Hành động hợp lệ theo trạng thái — cổng này app tự đặt vì máy chủ không có. */
export function ptActions(status: string | null | undefined): PtAction[] {
  if (status === "SUBMITTED") return ["UNDER_REVIEW", "APPROVE", "REQUEST_INFO", "REJECT"];
  if (status === "UNDER_REVIEW") return ["APPROVE", "REQUEST_INFO", "REJECT"];
  return [];
}

export function ptWaitingText(status: string | null | undefined): string | null {
  if (status === "NEEDS_MORE_INFO") return "Đang chờ người nộp bổ sung — đơn sẽ quay lại “Mới nộp” khi họ gửi lại.";
  if (status === "DRAFT") return "Người dùng chưa nộp đơn này.";
  return null;
}

export type PtApplication = Record<string, any> & { id: string; status: string };

export function ptApplicationRows(raw: unknown): PtApplication[] {
  const d = (raw as any)?.data ?? raw;
  return (Array.isArray(d) ? d : []).filter((a: any) => a?.id);
}

const QUEUE_RANK: Record<string, number> = { SUBMITTED: 0, UNDER_REVIEW: 1, NEEDS_MORE_INFO: 2, DRAFT: 3, APPROVED: 4, REJECTED: 5 };

/** Việc cần làm lên trước, trong mỗi nhóm thì nộp sớm nhất lên đầu. */
export function sortPtQueue(rows: PtApplication[]): PtApplication[] {
  const t = (a: PtApplication) => new Date(a.submittedAt ?? a.createdAt ?? 0).getTime() || 0;
  return [...rows].sort((a, b) => (QUEUE_RANK[a.status] ?? 9) - (QUEUE_RANK[b.status] ?? 9) || t(a) - t(b));
}

export function ptAwaitingCount(rows: PtApplication[]): number {
  return rows.filter((a) => a.status === "SUBMITTED" || a.status === "UNDER_REVIEW").length;
}

export function applicantName(a: PtApplication): string {
  const u = a.user ?? a.userProfile ?? {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email || "Người nộp";
}

export function applicantEmail(a: PtApplication): string {
  return String((a.user ?? a.userProfile ?? {}).email ?? "");
}

/** Lời nhắn cho người nộp — bắt buộc khi yêu cầu bổ sung hoặc từ chối (máy chủ cũng bắt). */
export function ptMessageError(action: PtAction, message: string): string | null {
  if (action !== "REQUEST_INFO" && action !== "REJECT") return null;
  if (!message.trim()) return action === "REJECT" ? "Nhập lý do từ chối — người nộp sẽ đọc câu này." : "Nêu rõ cần bổ sung gì.";
  if (message.trim().length < 10) return "Lời nhắn quá ngắn để người nộp hiểu.";
  return null;
}

export function ptReviewPayload(action: PtAction, message: string): Record<string, string> {
  const m = message.trim();
  if (action === "REQUEST_INFO") return { adminNote: m };
  if (action === "REJECT") return { rejectionReason: m };
  return {};
}

/** Giấy tờ của đơn: 3 ảnh định danh + chứng chỉ + ảnh/portfolio, đường dẫn đã ký tạm từ máy chủ. */
export function ptDocuments(a: PtApplication): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const push = (label: string, url: unknown) => {
    if (typeof url === "string" && url.trim()) out.push({ label, url });
  };
  push("CCCD mặt trước", a.idCardFrontUrl);
  push("CCCD mặt sau", a.idCardBackUrl);
  push("Ảnh chân dung", a.portraitPhotoUrl);
  (Array.isArray(a.certificates) ? a.certificates : []).forEach((c: any, i: number) =>
    push(c?.certificateName || `Chứng chỉ ${i + 1}`, c?.certificateFileUrl),
  );
  (Array.isArray(a.media) ? a.media : []).forEach((m: any, i: number) => push(m?.caption || `Ảnh minh hoạ ${i + 1}`, m?.url ?? m?.fileUrl));
  return out;
}

/** Đường dẫn giấy tờ là tương đối (`/pt-applications/documents/...?exp&sig`) — ghép với địa chỉ máy chủ. */
export function absoluteUrl(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

const WEEKDAY_VI: Record<string, string> = {
  MONDAY: "Thứ 2",
  TUESDAY: "Thứ 3",
  WEDNESDAY: "Thứ 4",
  THURSDAY: "Thứ 5",
  FRIDAY: "Thứ 6",
  SATURDAY: "Thứ 7",
  SUNDAY: "Chủ nhật",
};

/** Lịch rảnh khai trong đơn — tên ngày của máy chủ là enum tiếng Anh. */
export function availabilityLines(a: PtApplication): string[] {
  const blocks = Array.isArray(a.availabilityBlocks) ? a.availabilityBlocks : [];
  return blocks.map((b: any) => `${WEEKDAY_VI[b?.dayOfWeek] ?? b?.dayOfWeek}: ${b?.startTime}–${b?.endTime}`);
}

const SERVICE_MODE: Record<string, string> = { ONLINE: "Trực tuyến", OFFLINE: "Trực tiếp", BOTH: "Trực tuyến & trực tiếp", HYBRID: "Trực tuyến & trực tiếp" };
export const serviceModeLabel = (m: unknown) => SERVICE_MODE[String(m ?? "")] ?? (m ? String(m) : "—");

// ── Kế hoạch tập trên chợ ─────────────────────────────────────────────────────────────────────

export const LISTING_FILTERS: { value: string; label: string }[] = [
  { value: "SUBMITTED", label: "Chờ duyệt" },
  { value: "APPROVED", label: "Đã duyệt" },
  { value: "REJECTED", label: "Đã từ chối" },
];

export const AI_RECOMMENDATION: Record<string, { label: string; tone: StatusTone }> = {
  likely_safe: { label: "Gợi ý: có vẻ ổn", tone: "success" },
  needs_review: { label: "Gợi ý: cần xem kỹ", tone: "warning" },
  likely_unsafe: { label: "Gợi ý: nguy cơ cao", tone: "danger" },
};

export const RULE_FLAG_LABEL: Record<string, string> = {
  NO_REST_DAY: "Không có ngày nghỉ (7/7 ngày)",
  HIGH_FREQUENCY_WITHOUT_PROGRESSION_NOTES: "Tần suất cao nhưng thiếu ghi chú tiến trình",
  EXCESSIVE_VOLUME_PER_SESSION: "Khối lượng một buổi quá cao",
  EXCESSIVE_SETS_SINGLE_EXERCISE: "Một bài tập có quá nhiều hiệp",
  MISSING_RECOVERY_NOTES_HIGH_FREQUENCY: "Tần suất cao nhưng thiếu ghi chú hồi phục",
  DUPLICATE_EXERCISE_SAME_SESSION: "Trùng bài tập trong cùng buổi",
  EMPTY_SCHEDULE: "Lịch tập trống",
};

export type Listing = Record<string, any> & { id: string; title: string };

export function listingRows(raw: unknown): Listing[] {
  const d = (raw as any)?.data ?? raw;
  return (Array.isArray(d) ? d : []).filter((l: any) => l?.id);
}

export function listingAnalysis(l: Listing) {
  const a = Array.isArray(l.moderationAnalyses) ? l.moderationAnalyses[0] : null;
  if (!a) return null;
  return {
    recommendation: AI_RECOMMENDATION[a.aiRecommendation] ?? AI_RECOMMENDATION.needs_review,
    usedFallback: a.usedFallback === true,
    flags: (Array.isArray(a.ruleFlags) ? a.ruleFlags : []).map((f: string): string => RULE_FLAG_LABEL[f] ?? f) as string[],
    similar: (Array.isArray(a.similarListings) ? a.similarListings : []).map(
      (s: any): string => `${s.title} (${Math.round(Number(s.similarityScore ?? 0) * 100)}%)`,
    ) as string[],
  };
}

export function listingSchedule(l: Listing): { title: string; exercises: string[] }[] {
  const days = l.sourcePlan?.plan?.weeklySchedule;
  return (Array.isArray(days) ? days : []).map((day: any, i: number) => ({
    title: [day?.day ?? `Buổi ${i + 1}`, day?.goal].filter(Boolean).join(" · "),
    exercises: (Array.isArray(day?.exercises) ? day.exercises : []).map(
      (ex: any) => `${ex?.name ?? ex?.exerciseName ?? "Bài tập"} — ${ex?.sets ?? "?"}×${ex?.reps ?? "?"}`,
    ),
  }));
}

/** Chứng chỉ khai trong đơn (tên, nơi cấp, còn hiệu lực) — kể cả khi không kèm tệp. */
export function ptCertificates(a: PtApplication): { name: string; issuer: string; valid: boolean }[] {
  return (Array.isArray(a.certificates) ? a.certificates : []).map((c: any) => ({
    name: String(c?.certificateName ?? "Chứng chỉ"),
    issuer: String(c?.issuingOrganization ?? ""),
    valid: c?.isCurrentlyValid !== false,
  }));
}

export function listingRejectError(note: string): string | null {
  if (!note.trim()) return "Nhập lý do — người đăng sẽ đọc câu này.";
  if (note.trim().length < 10) return "Lý do quá ngắn để người đăng hiểu cần sửa gì.";
  return null;
}
