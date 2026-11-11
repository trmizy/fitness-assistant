/**
 * N09C-02 / N-A-01: what a gym-service error looks like to a USER.
 *
 * Many services throw an English sentence ("Cannot cancel membership in ACTIVE status", "Not authorized — you do not own this gym") or a bare
 * code as the message ("VALIDATION_ERROR", "ALREADY_PAID"), and the controllers copy `e.message` into the response. Rewriting 100+ throw sites
 * (and the tests, and every client that may match on them) is not the smallest correction; instead every error RESPONSE passes through
 * `localizeErrorBody` (middleware/localize-errors.middleware.ts), which
 *   - keeps the error `code` untouched (a missing code is taken from the bare-code message or a stable one is added; an English sentence that an
 *     old route uses AS the code is NOT rewritten: the admin web matches on it, see useAdminError.ts),
 *   - replaces an English / bare-code `message` by a Vietnamese one,
 *   - never lets an unknown English message out of a 5xx (Prisma text, file paths, stack lines): it becomes a generic Vietnamese sentence.
 * A message that is already Vietnamese is never touched (except a 5xx that carries a Prisma / path marker).
 */
const VIETNAMESE = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i;
export const hasVietnamese = (text: string): boolean => VIETNAMESE.test(text);

export const GENERIC_SERVER_ERROR_VI = 'Hệ thống đang gặp lỗi. Vui lòng thử lại sau.';

/** Marks of an internal message: Prisma client text, source paths, stack frames. */
const INTERNAL_MARKERS = /Invalid `|prisma|PrismaClient|\bat .*\(.*:\d+:\d+\)|[/\\](?:app|src|node_modules)[/\\]|\.(?:ts|js):\d+|ECONNREFUSED|ETIMEDOUT/i;
export const looksInternal = (text: string): boolean => INTERNAL_MARKERS.test(text);

const CODE_RE = /^[A-Z][A-Z0-9_]{2,}$/;

const STATUS_VI: Record<string, string> = {
  PENDING_PAYMENT: 'chờ thanh toán',
  ACTIVE: 'đang hoạt động',
  EXPIRED: 'đã hết hạn',
  CANCELLED: 'đã huỷ',
  PENDING_ISSUE: 'đang chờ xử lý cấp gói',
  PENDING: 'đang chờ phản hồi',
  REJECTED: 'đã từ chối',
  SUSPENDED: 'đang tạm ngưng',
};
const statusVi = (s: string): string => STATUS_VI[s] ?? 'hiện tại';

export interface Localized {
  message: string;
  /** a stable code to add when the response had none */
  code?: string;
}

const EXACT: Record<string, Localized> = {
  'Authentication required': { message: 'Bạn cần đăng nhập để thực hiện thao tác này.', code: 'UNAUTHORIZED' },
  'Insufficient permissions': { message: 'Bạn không có quyền thực hiện thao tác này.', code: 'FORBIDDEN' },
  'Not authorized': { message: 'Bạn không có quyền thực hiện thao tác này.', code: 'FORBIDDEN' },
  'Not authorized — you do not own this gym': { message: 'Bạn không phải chủ của phòng gym này nên không thực hiện được thao tác.', code: 'NOT_GYM_OWNER' },
  'Not authorized — you do not own this brand': { message: 'Bạn không phải chủ của thương hiệu này nên không thực hiện được thao tác.', code: 'NOT_BRAND_OWNER' },
  'Gym not found': { message: 'Không tìm thấy phòng gym.', code: 'GYM_NOT_FOUND' },
  'Brand not found': { message: 'Không tìm thấy thương hiệu.', code: 'BRAND_NOT_FOUND' },
  'Plan not found': { message: 'Không tìm thấy gói hội viên.', code: 'PLAN_NOT_FOUND' },
  'Plan not found or inactive': { message: 'Không tìm thấy gói hội viên này hoặc gói đã ngừng bán.', code: 'PLAN_NOT_FOUND' },
  'Membership not found': { message: 'Không tìm thấy gói hội viên.', code: 'MEMBERSHIP_NOT_FOUND' },
  'Invitation not found': { message: 'Không tìm thấy lời mời.', code: 'INVITATION_NOT_FOUND' },
  'Brand name is required': { message: 'Tên thương hiệu là bắt buộc.', code: 'VALIDATION_ERROR' },
  'saleStartAt must be before saleEndAt': { message: 'Ngày bắt đầu bán phải trước ngày kết thúc bán.', code: 'VALIDATION_ERROR' },
  'Membership has already expired': { message: 'Gói hội viên này đã hết hạn.', code: 'MEMBERSHIP_EXPIRED' },
  'No payment on record to refund': { message: 'Gói hội viên này chưa có khoản thanh toán nào để hoàn tiền.', code: 'NO_PAYMENT_TO_REFUND' },
  'No payment transaction on record — cannot refund': { message: 'Chưa ghi nhận giao dịch thanh toán nên không hoàn tiền được.', code: 'NO_PAYMENT_TO_REFUND' },
  'Transaction verification failed': { message: 'Không xác minh được giao dịch thanh toán. Vui lòng thử lại sau.', code: 'TRANSACTION_VERIFICATION_FAILED' },
  'Original transaction verification failed': { message: 'Không xác minh được giao dịch thanh toán gốc. Vui lòng thử lại sau.', code: 'TRANSACTION_VERIFICATION_FAILED' },
  'Refund transaction verification failed': { message: 'Không xác minh được giao dịch hoàn tiền. Vui lòng thử lại sau.', code: 'TRANSACTION_VERIFICATION_FAILED' },
  'Internal server error': { message: GENERIC_SERVER_ERROR_VI, code: 'INTERNAL_ERROR' },
};

const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => Localized]> = [
  [/^Cannot cancel (?:a )?membership in (\w+) status$/, (m) => ({ message: `Không huỷ được gói hội viên vì gói đang ở trạng thái "${statusVi(m[1])}".`, code: 'MEMBERSHIP_STATUS_NOT_CANCELLABLE' })],
  [/^Cannot pay for membership in (\w+) status$/, (m) => ({ message: `Không thanh toán được vì gói hội viên đang ở trạng thái "${statusVi(m[1])}".`, code: 'MEMBERSHIP_STATUS_NOT_PAYABLE' })],
  [/^Cannot refund a membership in (\w+) status$/, (m) => ({ message: `Không hoàn tiền được vì gói hội viên đang ở trạng thái "${statusVi(m[1])}".`, code: 'MEMBERSHIP_STATUS_NOT_REFUNDABLE' })],
  [/^Cannot respond to invitation in (\w+) status$/, (m) => ({ message: `Không phản hồi được lời mời vì lời mời ${statusVi(m[1])}.`, code: 'INVITATION_STATUS_NOT_RESPONDABLE' })],
  [/^Membership cannot be activated by this payment \(status (\w+)\)$/, (m) => ({ message: `Thanh toán này không kích hoạt được gói hội viên (gói ${statusVi(m[1])}).`, code: 'MEMBERSHIP_NOT_ACTIVATABLE' })],
  [/^Membership is not PENDING_ISSUE \(status (\w+)\)$/, (m) => ({ message: `Gói hội viên không ở trạng thái chờ xử lý cấp gói (hiện ${statusVi(m[1])}).`, code: 'MEMBERSHIP_NOT_PENDING_ISSUE' })],
  [/^reason must be one of:/, () => ({ message: 'Lý do hoàn tiền không hợp lệ.', code: 'INVALID_REFUND_REASON' })],
];

/** Bare business codes (as `code`, or used as the message). */
export const CODE_MESSAGES_VI: Record<string, string> = {
  VALIDATION_ERROR: 'Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra lại các ô đã nhập.',
  UNAUTHORIZED: 'Bạn cần đăng nhập để thực hiện thao tác này.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  INTERNAL_ERROR: GENERIC_SERVER_ERROR_VI,
  // memberships
  ALREADY_PAID: 'Gói hội viên này đã được thanh toán.',
  ALREADY_HAS_PENDING_MEMBERSHIP: 'Bạn đang có một gói chờ thanh toán tại phòng gym này. Hãy thanh toán hoặc huỷ gói đó trước.',
  ALREADY_HAS_OPEN_MEMBERSHIP: 'Bạn đang có một gói hội viên còn hiệu lực tại phòng gym này.',
  REFERRAL_CODE_NOT_FOUND: 'Không tìm thấy mã giới thiệu này.',
  CANNOT_REFER_YOURSELF: 'Bạn không thể dùng mã giới thiệu của chính mình.',
  REFERRAL_NOT_APPLICABLE_AT_THIS_GYM: 'Mã giới thiệu này không áp dụng tại phòng gym này.',
  REFERRAL_ONLY_FOR_FIRST_MEMBERSHIP: 'Mã giới thiệu chỉ áp dụng cho gói hội viên đầu tiên.',
  INVALID_REFUND_REASON: 'Lý do hoàn tiền không hợp lệ.',
  FIXED_AMOUNT_NEEDS_CASE_DECISION: 'Hoàn tiền theo số tiền cố định cần một quyết định đã duyệt trong hồ sơ khiếu nại.',
  MEMBERSHIP_PAYOUT_ALREADY_RELEASED: 'Tiền của gói này đã được chuyển cho phòng gym nên không hoàn theo cách này được.',
  FIXED_AMOUNT_ABOVE_PAID: 'Số tiền hoàn vượt quá số tiền đã thanh toán.',
  NOT_A_MEMBER: 'Chỉ hội viên đã mua gói tại phòng gym này mới thực hiện được thao tác này.',
  GYM_NOT_FOUND: 'Không tìm thấy phòng gym.',
  GYM_HAS_NO_BRAND: 'Phòng gym này chưa thuộc thương hiệu nào.',
  GYM_NOT_ACTIVE: 'Phòng gym hiện không hoạt động.',
  PT_SESSION_CHECK_UNAVAILABLE: 'Chưa kiểm tra được buổi tập của huấn luyện viên. Vui lòng thử lại sau.',
  PT_NO_QUALIFYING_SESSION: 'Huấn luyện viên chưa có buổi tập phù hợp để check-in tại phòng gym này.',
  INVALID_TOKEN: 'Mã QR không hợp lệ.',
  TOKEN_EXPIRED: 'Mã QR đã hết hạn. Vui lòng tạo lại mã.',
  // check-in
  NOT_ACTIVE: 'Gói hội viên không còn hiệu lực để check-in.',
  TOO_SOON: 'Bạn vừa check-in xong. Vui lòng thử lại sau ít phút.',
  VISIT_LIMIT_REACHED: 'Gói hội viên đã dùng hết số lượt tập.',
  // front desk / assisted check-in
  SEARCH_RATE_LIMITED: 'Tra cứu quá nhiều lần. Vui lòng thử lại sau ít phút.',
  MEMBER_NOT_FOUND: 'Không tìm thấy hội viên.',
  SEARCH_QUERY_INVALID: 'Nội dung tra cứu không hợp lệ.',
  METHOD_DISABLED: 'Cách xác minh này hiện chưa được bật.',
  IDEMPOTENCY_KEY_REUSED: 'Yêu cầu này đã được gửi với nội dung khác. Vui lòng tải lại rồi thử lại.',
  IDEMPOTENCY_KEY_REQUIRED: 'Thiếu mã chống gửi trùng. Vui lòng tải lại trang rồi thử lại.',
  EXCEPTION_ALREADY_OPEN: 'Đã có một yêu cầu ngoại lệ đang chờ duyệt cho hội viên này.',
  EXCEPTION_NOT_FOUND: 'Không tìm thấy yêu cầu ngoại lệ.',
  EXCEPTION_SELF_APPROVAL: 'Người tạo yêu cầu ngoại lệ không được tự duyệt.',
  EXCEPTION_EXPIRED: 'Yêu cầu ngoại lệ đã hết hạn.',
  EXCEPTION_ALREADY_DECIDED: 'Yêu cầu ngoại lệ này đã được xử lý.',
  EXCEPTION_ALREADY_USED: 'Yêu cầu ngoại lệ này đã được dùng để check-in.',
  EXCEPTION_REQUIRED: 'Cần chọn yêu cầu ngoại lệ đã được duyệt.',
  PHOTO_UNAVAILABLE: 'Hội viên chưa có ảnh hồ sơ để đối chiếu.',
  PHOTO_ATTESTATION_REQUIRED: 'Cần xác nhận đã đối chiếu ảnh với hội viên.',
  MEMBER_CODE_MISMATCH: 'Mã hội viên không khớp.',
  MEMBER_EMAIL_UNAVAILABLE: 'Hội viên chưa có email để nhận mã xác minh.',
  OTP_REQUIRED: 'Cần nhập mã xác minh.',
  OTP_ALREADY_USED: 'Mã xác minh này đã được dùng.',
  OTP_CHALLENGE_INVALID: 'Mã xác minh không hợp lệ hoặc đã hết hạn. Vui lòng gửi mã mới.',
  OTP_INVALID: 'Mã xác minh không đúng.',
  OTP_EXPIRED: 'Mã xác minh đã hết hạn. Vui lòng gửi mã mới.',
  OTP_ATTEMPTS_EXCEEDED: 'Bạn đã nhập sai quá số lần cho phép. Vui lòng gửi mã mới.',
  OTP_RESEND_TOO_SOON: 'Vừa gửi mã xong. Vui lòng đợi một lúc rồi gửi lại.',
  OTP_DAILY_LIMIT: 'Đã đạt giới hạn gửi mã trong ngày cho hội viên này.',
  OTP_DELIVERY_FAILED: 'Không gửi được mã xác minh tới email của hội viên. Vui lòng thử lại hoặc dùng cách xác minh khác.',
  REASON_REQUIRED: 'Cần nhập lý do.',
};

/** The Vietnamese rendering of an error, or null when nothing here knows it. */
export function localizeMessage(message: string | undefined, code: string | undefined): Localized | null {
  if (message) {
    const exact = EXACT[message];
    if (exact) return exact;
    for (const [re, build] of PATTERNS) {
      const m = message.match(re);
      if (m) return build(m);
    }
    if (CODE_RE.test(message) && CODE_MESSAGES_VI[message]) return { message: CODE_MESSAGES_VI[message], code: message };
  }
  if (code && CODE_MESSAGES_VI[code]) return { message: CODE_MESSAGES_VI[code] };
  return null;
}

type Body = { success?: unknown; message?: unknown; error?: unknown } & Record<string, unknown>;

/**
 * Pure: returns the body to send. Only `{ success:false, error:{...} }` bodies with status >= 400 are looked at; everything else is returned
 * as is. `onInternal` receives the original text when a 5xx message was withheld (so the server log keeps it).
 */
export function localizeErrorBody(status: number, body: unknown, onInternal?: (original: string) => void): unknown {
  if (status < 400 || !body || typeof body !== 'object' || Array.isArray(body)) return body;
  const b = body as Body;
  if (b.success !== false || !b.error || typeof b.error !== 'object' || Array.isArray(b.error)) return body;
  const error = b.error as { code?: unknown; message?: unknown };
  const message = typeof error.message === 'string' ? error.message : undefined;
  const code = typeof error.code === 'string' ? error.code : undefined;

  // An English sentence that an old route uses AS the code is left exactly as it is (the admin web matches on it); here it only serves as a lookup key.
  const codeIsSentence = !!code && /\s/.test(code);
  const vietnameseAlready = !!message && hasVietnamese(message) && !(status >= 500 && looksInternal(message));

  const found = vietnameseAlready ? null : (localizeMessage(message, codeIsSentence ? undefined : code) ?? (codeIsSentence ? localizeMessage(code, undefined) : null));

  if (found) {
    error.message = found.message;
    if (typeof b.message === 'string' && !hasVietnamese(b.message)) b.message = found.message;
    if (!code) {
      const stable = found.code ?? (message && CODE_RE.test(message) ? message : undefined);
      if (stable) error.code = stable;
    }
    return b;
  }

  if (vietnameseAlready) return b;

  if (status >= 500) {
    // unknown English / internal text must not leave a 5xx
    const original = message ?? (typeof b.message === 'string' ? b.message : undefined);
    if (original) onInternal?.(original);
    error.message = GENERIC_SERVER_ERROR_VI;
    if (typeof b.message === 'string') b.message = GENERIC_SERVER_ERROR_VI;
    if (!code) error.code = 'INTERNAL_ERROR';
    return b;
  }

  // a 4xx nobody here knows stays as it is
  return b;
}
