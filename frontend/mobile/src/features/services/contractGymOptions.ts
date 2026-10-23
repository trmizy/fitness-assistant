/**
 * Phase 3 / P3.6 — the client's side of "which gym, and may I?" when asking a trainer for a
 * contract, plus the pre-payment summary of a contract the trainer already accepted.
 *
 * The server is the authority for everything here:
 *  - `GET /contracts/gym-options?ptUserId=&packageId=` lists the branches and, per branch, FACTS
 *    about the client's membership. It may also carry `eligibility: { canRequest, reason }` per
 *    branch (P3.3). That field is OPTIONAL — absent means "no information", never "not allowed" —
 *    so this keeps working against a backend that does not send it yet.
 *  - `POST /contracts/request` answers 422 with the same two reason codes when the rule is
 *    enforced; that answer wins over anything shown earlier.
 *  - `GET /contracts/:id/checkout-context` supplies the amount, the deadline and the re-check
 *    results for a PENDING_PAYMENT contract.
 *
 * Nothing here computes money, a revenue split or a gym's eligibility. Revenue-split rates, internal
 * ids and internal enum names are never turned into text for the client.
 *
 * Kept byte-identical with frontend/web/src/app/utils/contractGymOptions.ts.
 */

export type EligibilityReason = "MEMBERSHIP_REQUIRED" | "MEMBERSHIP_DOES_NOT_COVER_CONTRACT";

export const MEMBERSHIP_REQUIRED_COPY =
  "Bạn cần có gói hội viên còn hiệu lực tại phòng tập này để đăng ký với PT.";
export const MEMBERSHIP_DOES_NOT_COVER_COPY =
  "Gói hội viên hiện tại không đủ thời hạn cho hợp đồng PT này.";
/** `canRequest: false` with a reason this app does not know yet — still blocked, still honest. */
export const ELIGIBILITY_UNKNOWN_BLOCK_COPY =
  "Bạn chưa thể đăng ký với PT tại phòng tập này.";

const ELIGIBILITY_COPY: Record<EligibilityReason, string> = {
  MEMBERSHIP_REQUIRED: MEMBERSHIP_REQUIRED_COPY,
  MEMBERSHIP_DOES_NOT_COVER_CONTRACT: MEMBERSHIP_DOES_NOT_COVER_COPY,
};

export function isEligibilityReason(value: unknown): value is EligibilityReason {
  return value === "MEMBERSHIP_REQUIRED" || value === "MEMBERSHIP_DOES_NOT_COVER_CONTRACT";
}

/** Vietnamese for a reason code; unknown / null code gives null (the caller decides the fallback). */
export function eligibilityCopy(reason: unknown): string | null {
  return isEligibilityReason(reason) ? ELIGIBILITY_COPY[reason] : null;
}

// --- date helpers (display only) -----------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "20/12/2026" from an ISO timestamp; "" when it is not a date. */
export function formatDateVi(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "14:30 17/10/2026" from an ISO timestamp; "" when it is not a date. */
export function formatDateTimeVi(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())} ${formatDateVi(iso)}`;
}

// --- gym options ---------------------------------------------------------------------------

export type GymMembershipFact = {
  hasActiveMembership: boolean;
  planName: string | null;
  endDate: string | null;
};

export type GymEligibility = {
  /** False when the backend did not send `eligibility` (or sent something unreadable): no information. */
  known: boolean;
  /** Only an explicit `false` (or a known blocking reason) blocks; absence never does. */
  canRequest: boolean;
  /** The code as sent when it is one this app knows, else null. */
  reason: EligibilityReason | null;
};

export type GymOption = {
  gymId: string;
  name: string;
  city: string | null;
  isPtTrainingLocation: boolean;
  membership: GymMembershipFact;
  eligibility: GymEligibility;
  /** The branch can be chosen for the request. */
  selectable: boolean;
  /** Plain-language membership line: has a plan until a date, or none. */
  membershipLabel: string;
  /** Why it can not be chosen, in the client's words (null when selectable). */
  blockedCopy: string | null;
  /** The reason is "buy a membership first" — the screen offers the purchase screen. */
  offersMembershipPurchase: boolean;
};

export type GymOptionsView = {
  sessionMode: string | null;
  /** The trainer's own referral code, to pre-fill the membership purchase. Null when none. */
  ptReferralCode: string | null;
  /** Server's pre-check refusal code (PT unavailable, contract already exists, ...). */
  requestBlockedCode: string | null;
  /** The same, in the client's words. */
  requestBlockedCopy: string | null;
  gymsReason: string | null;
  /** A neutral sentence for an empty list; null when there is nothing special to say. */
  gymsReasonCopy: string | null;
  gyms: GymOption[];
};

const REQUEST_BLOCKED_COPY: Record<string, string> = {
  PT_TEMPORARILY_UNAVAILABLE:
    "Huấn luyện viên đang tạm ngưng nhận hợp đồng mới. Bạn vui lòng quay lại sau.",
  PT_ACCOUNT_LOCKED: "Huấn luyện viên này hiện không nhận khách mới.",
  PT_NOT_ACCEPTING_CLIENTS: "Huấn luyện viên hiện không nhận khách mới.",
  ACTIVE_CONTRACT_EXISTS:
    "Bạn đang có hợp đồng với huấn luyện viên này. Hãy kết thúc hợp đồng cũ trước khi gửi yêu cầu mới.",
};
const REQUEST_BLOCKED_FALLBACK = "Hiện chưa thể gửi yêu cầu tới huấn luyện viên này.";

export function requestBlockedCopy(code: string | null | undefined): string | null {
  if (!code) return null;
  return REQUEST_BLOCKED_COPY[code] ?? REQUEST_BLOCKED_FALLBACK;
}

const GYMS_REASON_COPY: Record<string, string> = {
  ONLINE_PACKAGE: "Gói online không gắn với phòng gym nên bạn không cần chọn phòng tập.",
  NO_GYM_AGREEMENT: "Huấn luyện viên hiện chưa có phòng gym nào để bạn chọn.",
};

export function gymsReasonCopy(code: string | null | undefined): string | null {
  if (!code) return null;
  return GYMS_REASON_COPY[code] ?? null;
}

export function membershipLabel(m: GymMembershipFact): string {
  if (!m.hasActiveMembership) return "Chưa có gói hội viên";
  const until = formatDateVi(m.endDate);
  return until ? `Đang có gói hội viên · hết hạn ${until}` : "Đang có gói hội viên";
}

/** Reads the OPTIONAL per-branch `eligibility`. Anything unreadable counts as "no information". */
export function readEligibility(raw: any): GymEligibility {
  const e = raw?.eligibility;
  if (!e || typeof e !== "object" || Array.isArray(e)) {
    return { known: false, canRequest: true, reason: null };
  }
  const reason = isEligibilityReason(e.reason) ? e.reason : null;
  const hasFlag = typeof e.canRequest === "boolean";
  // A reason code always means "blocked"; an explicit false blocks even with a code we do not know.
  if (e.canRequest === false || (reason !== null && e.canRequest !== true)) {
    return { known: true, canRequest: false, reason };
  }
  return { known: hasFlag || reason !== null, canRequest: true, reason: null };
}

function normalizeGymOption(raw: any): GymOption | null {
  const gymId = String(raw?.gymId ?? "");
  if (!gymId) return null;
  const m = raw?.membership ?? {};
  const membership: GymMembershipFact = {
    hasActiveMembership: m?.hasActiveMembership === true,
    planName: typeof m?.planName === "string" ? m.planName : null,
    endDate: typeof m?.endDate === "string" ? m.endDate : null,
  };
  const eligibility = readEligibility(raw);
  const blockedCopy = eligibility.canRequest
    ? null
    : (eligibilityCopy(eligibility.reason) ?? ELIGIBILITY_UNKNOWN_BLOCK_COPY);
  return {
    gymId,
    name: String(raw?.name ?? "Phòng gym"),
    city: typeof raw?.city === "string" && raw.city ? raw.city : null,
    isPtTrainingLocation: raw?.isPtTrainingLocation === true,
    membership,
    eligibility,
    selectable: eligibility.canRequest,
    membershipLabel: membershipLabel(membership),
    blockedCopy,
    offersMembershipPurchase: eligibility.reason === "MEMBERSHIP_REQUIRED",
  };
}

/** `GET /contracts/gym-options`. The server's order (training locations first) is preserved. */
export function normalizeGymOptions(raw: any): GymOptionsView {
  const code = typeof raw?.requestBlockedReason === "string" ? raw.requestBlockedReason : null;
  const gymsReason = typeof raw?.gymsReason === "string" ? raw.gymsReason : null;
  const list: any[] = Array.isArray(raw?.gyms) ? raw.gyms : [];
  const referral = typeof raw?.pt?.referralCode === "string" ? raw.pt.referralCode.trim() : "";
  return {
    sessionMode: typeof raw?.sessionMode === "string" ? raw.sessionMode : null,
    ptReferralCode: referral || null,
    requestBlockedCode: code,
    requestBlockedCopy: requestBlockedCopy(code),
    gymsReason,
    gymsReasonCopy: gymsReasonCopy(gymsReason),
    gyms: list.map(normalizeGymOption).filter((g): g is GymOption => g !== null),
  };
}

/** The picked branch, if it is still on the list and selectable (a stale pick is dropped). */
export function pickableGym(view: GymOptionsView | null, gymId: string | null): GymOption | null {
  if (!view || !gymId) return null;
  const g = view.gyms.find((x) => x.gymId === gymId);
  return g && g.selectable ? g : null;
}

// --- 422 from POST /contracts/request -------------------------------------------------------

/**
 * The membership refusal `requestContract` answers with (HTTP 422), or null for any other error.
 * The code is read from the places this backend puts codes (`code`, `errorCode`, `error.code`, or
 * `error` itself being the code), so a harmless change in shape does not lose the message.
 */
export function readEligibilityRefusal(
  error: any,
): { reason: EligibilityReason; message: string } | null {
  if (error?.response?.status !== 422) return null;
  const d = error?.response?.data ?? null;
  const candidates = [d?.code, d?.errorCode, d?.error?.code, d?.error, d?.reason];
  const reason = candidates.find(isEligibilityReason);
  if (!reason) return null;
  return { reason, message: ELIGIBILITY_COPY[reason] };
}

// --- checkout context (PENDING_PAYMENT) -------------------------------------------------------

export type CheckoutSummary = {
  packageName: string;
  totalSessions: number;
  sessionMode: string | null;
  sessionDurationMinutes: number | null;
  validityDays: number | null;
  /** The price the server will charge; null when the response had none. */
  amount: number | null;
  /** Needed only to look the gym's name up; never shown. Null for an independent contract. */
  gymId: string | null;
  paymentDueAt: string | null;
  paymentDueLabel: string | null;
  /** Everything the server's re-check reported that the client should know before paying. */
  warnings: string[];
};

const GYM_RECHECK_COPY: Record<string, string> = {
  GYM_NOT_ACCEPTING_CONTRACTS:
    "Phòng gym hiện không nhận hợp đồng mới nên có thể chưa thanh toán được lúc này.",
  GYM_TERMS_CHANGED:
    "Điều khoản hợp tác của phòng gym đã thay đổi từ lúc bạn gửi yêu cầu. Hãy nhắn cho huấn luyện viên để được xác nhận lại.",
  UNKNOWN:
    "Chưa kiểm tra được tình trạng phòng gym lúc này. Hệ thống sẽ kiểm tra lại khi bạn thanh toán.",
};
export const PT_RECHECK_COPY =
  "Huấn luyện viên hiện đang tạm ngưng nhận giao dịch mới nên có thể chưa thanh toán được lúc này.";
export const DEADLINE_PASSED_COPY =
  "Đã quá hạn thanh toán — hệ thống có thể từ chối giao dịch này.";

const finite = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Warning sentences from `recheck`; `[]` when everything is fine or nothing was reported. */
export function checkoutWarnings(recheck: any): string[] {
  const out: string[] = [];
  if (!recheck || typeof recheck !== "object") return out;
  const pt = recheck.ptAcceptsNewBusiness;
  if (pt !== undefined && pt !== true) out.push(PT_RECHECK_COPY);
  if (recheck.paymentDeadlinePassed === true) out.push(DEADLINE_PASSED_COPY);
  const gym = GYM_RECHECK_COPY[String(recheck.gym ?? "")];
  if (gym) out.push(gym);
  return out;
}

/** `GET /contracts/:id/checkout-context`. Rates, party ids and agreement ids are dropped on purpose. */
export function normalizeCheckoutContext(raw: any): CheckoutSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const pkg = raw.package ?? {};
  const due = typeof raw?.payment?.paymentDueAt === "string" ? raw.payment.paymentDueAt : null;
  const gymId = raw?.gym?.gymId ?? raw?.parties?.gymId ?? null;
  return {
    packageName: typeof pkg.name === "string" && pkg.name ? pkg.name : "Gói huấn luyện",
    totalSessions: finite(pkg.totalSessions) ?? 0,
    sessionMode: typeof pkg.sessionMode === "string" ? pkg.sessionMode : null,
    sessionDurationMinutes: finite(pkg.sessionDurationMinutes),
    validityDays: finite(pkg.validityDays),
    amount: finite(raw.amount),
    gymId: typeof gymId === "string" && gymId ? gymId : null,
    paymentDueAt: due,
    paymentDueLabel: formatDateTimeVi(due) || null,
    warnings: checkoutWarnings(raw.recheck),
  };
}
