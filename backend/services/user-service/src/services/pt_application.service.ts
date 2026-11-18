import axios from "axios";
import { logger } from "@gym-coach/shared";
import { ptApplicationRepository } from "../repositories/pt_application.repository";
import { profileRepository } from "../repositories/profile.repository";
import { PrismaClient, PTApplicationStatus } from "../generated/prisma";
import { ptApplicationsTotal } from "@gym-coach/shared";
import { signPtApplicationDocumentUrls } from "../utils/ptDocumentUrl.util";
import { assignReferralCodeIfMissing } from "../utils/referralCode";
import { availabilityService } from "./availability.service";
import { authServiceClient } from "../clients/auth-service.client";
import { notificationService } from "./notification.service";
import { ptApplicationReviewNotice } from "../utils/ptApplicationNotice.util";
import { profileNameFields } from "../utils/profileName.util";
import { ptTermsService, PT_TERMS_NOT_ACCEPTED } from "./pt-terms.service";
import { PT_TERMS_VERSION } from "./pt-terms";
import { isValidPhoneNumber, PHONE_INVALID_MESSAGE } from "../utils/phone.util";
import { parseOptionalVnCoords } from "../utils/vn-coords.util";

/** An error the controller can answer with its own HTTP status and a machine-readable code. */
function httpError(message: string, status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

const prisma = new PrismaClient();

/** Q1 (owner, 14/11/2026): a rejected applicant may apply again, but an account is rejected at most this many times. */
export const MAX_PT_APPLICATION_REJECTIONS = 3;
export const PT_APPLICATION_LIMIT_REACHED = "PT_APPLICATION_LIMIT_REACHED";
export const INVALID_APPLICATION_TRANSITION = "INVALID_APPLICATION_TRANSITION";
/** Audit verb written (entityType PT_PROFILE, entityId = applicant userId) each time an application is rejected. */
export const PT_APPLICATION_REJECTED_AUDIT = "PT_APPLICATION_REJECTED";

/**
 * How many times this account's PT application has been rejected, derived from the audit trail (no schema change):
 * one PT_APPLICATION_REJECTED row per rejection. An application that is REJECTED today but predates the audit row
 * (a legacy rejection) counts as one.
 */
export async function countPtApplicationRejections(
  userId: string,
  currentStatus?: PTApplicationStatus | string | null,
): Promise<number> {
  const audited = await ptApplicationRepository.countRejectionAudits(userId, PT_APPLICATION_REJECTED_AUDIT);
  return audited === 0 && currentStatus === PTApplicationStatus.REJECTED ? 1 : audited;
}

async function assertRejectionLimitNotReached(userId: string, currentStatus?: PTApplicationStatus | string | null) {
  const rejections = await countPtApplicationRejections(userId, currentStatus);
  if (rejections >= MAX_PT_APPLICATION_REJECTIONS) {
    throw httpError(
      `Tài khoản đã bị từ chối ${MAX_PT_APPLICATION_REJECTIONS} lần nên không thể đăng ký làm huấn luyện viên nữa. Vui lòng liên hệ bộ phận hỗ trợ nếu cần xem xét lại.`,
      409,
      PT_APPLICATION_LIMIT_REACHED,
    );
  }
}

/**
 * Admin review state machine (Q2, owner-approved 14/11/2026). Only the applicant moves DRAFT -> SUBMITTED and
 * NEEDS_MORE_INFO -> SUBMITTED (submit()). An admin acts only on an application that is waiting for review:
 *   SUBMITTED / UNDER_REVIEW -> UNDER_REVIEW | NEEDS_MORE_INFO | APPROVED | REJECTED
 * APPROVED -> APPROVED is an idempotent no-op (handled before this check); every other move out of APPROVED, and
 * every move out of REJECTED (terminal for that application), DRAFT or NEEDS_MORE_INFO is refused. Removing an
 * approved PT goes through the PT suspend / deactivate flows, not through review actions.
 */
export const ADMIN_REVIEWABLE_STATUSES: readonly PTApplicationStatus[] = [
  PTApplicationStatus.SUBMITTED,
  PTApplicationStatus.UNDER_REVIEW,
];
export const ADMIN_REVIEW_TARGETS: readonly PTApplicationStatus[] = [
  PTApplicationStatus.UNDER_REVIEW,
  PTApplicationStatus.NEEDS_MORE_INFO,
  PTApplicationStatus.APPROVED,
  PTApplicationStatus.REJECTED,
];

/** Statuses from which an admin may take a review action (the web page uses the same rule to hide buttons). */
export function adminMayReview(current: PTApplicationStatus | string): boolean {
  return (ADMIN_REVIEWABLE_STATUSES as readonly string[]).includes(current);
}

export function assertAdminTransition(current: PTApplicationStatus, target: PTApplicationStatus) {
  if (adminMayReview(current) && (ADMIN_REVIEW_TARGETS as readonly string[]).includes(target)) return;
  const why: Record<string, string> = {
    DRAFT: "Đơn còn là bản nháp - chỉ người nộp đơn mới nộp được.",
    NEEDS_MORE_INFO: "Đơn đang chờ người nộp bổ sung - chỉ người nộp đơn mới nộp lại được.",
    APPROVED: "Đơn đã được duyệt - muốn gỡ huấn luyện viên hãy dùng chức năng tạm khóa / ngừng hoạt động huấn luyện viên.",
    REJECTED: "Đơn đã bị từ chối - người nộp phải nộp đơn mới.",
  };
  throw httpError(
    `Không thể chuyển đơn từ trạng thái hiện tại sang trạng thái này. ${why[current] ?? ""}`.trim(),
    409,
    INVALID_APPLICATION_TRANSITION,
  );
}

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

/**
 * Fetch user basic info (firstName, lastName, email) from auth-service by userId.
 * Returns null on any error (fail-safe: don't break the main response).
 */
async function fetchAuthUserInfo(userId: string): Promise<{
  firstName: string | null;
  lastName: string | null;
  email: string;
} | null> {
  try {
    const { data } = await authServiceClient.internalGet(
      `/auth/internal/users/${userId}`,
      { timeoutMs: 3000 },
    );
    const u = data?.user ?? data;
    return {
      firstName: u?.firstName ?? u?.first_name ?? null,
      lastName: u?.lastName ?? u?.last_name ?? null,
      email: u?.email ?? "",
    };
  } catch (err: any) {
    logger.warn(
      { err: err?.message, userId },
      "fetchAuthUserInfo: could not fetch from auth-service",
    );
    return null;
  }
}

/**
 * Enrich a PTApplication record with user display info.
 * Priority: auth-service data > cached userProfile fields.
 */
/**
 * B01: the application embeds the whole `userProfile` row, and that row carries `ptLockSeq`, a Postgres
 * BIGINT (Prisma BigInt). `JSON.stringify` throws "Do not know how to serialize a BigInt" on it, so every
 * admin list / detail response containing a trainer who has ever been locked (the PT lock command sets
 * ptLockSeq and never clears it) died with a 500 - row-specific, which is why only some APPROVED rows broke
 * the whole list. The sequence number is internal ordering state of the lock stream and the admin review
 * screen never needs it, so it is dropped here rather than stringified.
 */
export function withoutInternalProfileFields<T extends { userProfile?: any }>(app: T): T {
  const profile = app?.userProfile;
  if (!profile || typeof profile !== "object" || !("ptLockSeq" in profile)) return app;
  const { ptLockSeq: _ptLockSeq, ...safeProfile } = profile;
  return { ...app, userProfile: safeProfile };
}

/**
 * ADM-01: the admin list searches `user_profiles.email` in SQL, but the profile row often has no email (it is shown from auth-service
 * at display time). When a display fetch finds one, keep it: fills an EMPTY column only, best-effort, never blocks or fails the response.
 */
export function persistMissingProfileEmail(
  profile: { userId?: string | null; email?: string | null } | null | undefined,
  authEmail: string | null | undefined,
  repo: { backfillEmail: (userId: string, email: string) => Promise<unknown> } = profileRepository,
): void {
  const email = (authEmail ?? "").trim();
  if (!profile?.userId || profile.email || !email) return;
  void Promise.resolve()
    .then(() => repo.backfillEmail(profile.userId as string, email))
    .catch((err: any) => logger.warn({ err: err?.message, userId: profile.userId }, "PT application: could not backfill profile email"));
}

async function enrichWithUserInfo(rawApp: any): Promise<any> {
  const app = withoutInternalProfileFields(rawApp);
  const userId = app.userProfile?.userId;
  if (!userId) return app;

  // Use cached profile fields if both firstName and email are already present
  if (app.userProfile?.firstName && app.userProfile?.email) {
    return app;
  }

  const authInfo = await fetchAuthUserInfo(userId);
  if (!authInfo) return app;
  persistMissingProfileEmail(app.userProfile, authInfo.email);

  return {
    ...app,
    userProfile: {
      ...app.userProfile,
      firstName: app.userProfile?.firstName || authInfo.firstName,
      lastName: app.userProfile?.lastName || authInfo.lastName,
      email: app.userProfile?.email || authInfo.email,
    },
  };
}

async function validateLocationData(data: any): Promise<void> {
  const {
    residenceProvinceCode,
    residenceWardCode,
    applicationTrainingLocations,
  } = data;

  // Validate residence location if provided
  if (residenceProvinceCode) {
    const p = await prisma.vietnamProvince.findUnique({
      where: { code: Number(residenceProvinceCode) },
    });
    if (!p)
      throw new Error(
        `residenceProvinceCode ${residenceProvinceCode} không hợp lệ`,
      );
    if (residenceWardCode) {
      const w = await prisma.vietnamWard.findUnique({
        where: { code: Number(residenceWardCode) },
      });
      if (!w || w.provinceCode !== Number(residenceProvinceCode)) {
        throw new Error("residenceWardCode không thuộc tỉnh đã chọn");
      }
    }
  }

  // Sanitize training locations: filter out completely empty rows
  const rawLocations: any[] = applicationTrainingLocations ?? [];
  const normalizedLocations = rawLocations.filter(
    (loc: any) =>
      loc?.provinceCode || loc?.gymName?.trim() || loc?.addressLine?.trim(),
  );

  // Validate each non-empty location
  for (const loc of normalizedLocations) {
    if (!loc.provinceCode)
      throw new Error("provinceCode bắt buộc trong training location");
    const p = await prisma.vietnamProvince.findUnique({
      where: { code: Number(loc.provinceCode) },
    });
    if (!p)
      throw new Error(
        `provinceCode ${loc.provinceCode} trong training location không hợp lệ`,
      );
    if (loc.wardCode) {
      const w = await prisma.vietnamWard.findUnique({
        where: { code: Number(loc.wardCode) },
      });
      if (!w || w.provinceCode !== Number(loc.provinceCode)) {
        throw new Error(
          `wardCode ${loc.wardCode} không thuộc tỉnh ${loc.provinceCode}`,
        );
      }
    }
    if (loc.gymName && String(loc.gymName).length > 120) {
      throw new Error("gymName tối đa 120 ký tự");
    }
    if (loc.addressLine && String(loc.addressLine).length > 255) {
      throw new Error("addressLine tối đa 255 ký tự");
    }
    const coords = parseOptionalVnCoords(loc.latitude, loc.longitude);
    if (coords.present) {
      loc.latitude = coords.latitude;
      loc.longitude = coords.longitude;
    }
  }
}

async function validatePriceFields(data: any): Promise<void> {
  const priceFields = [
    "onlinePricePerSession",
    "offlinePricePerSession",
    "onlinePackagePrice",
    "offlinePackagePrice",
    "packagePrice",
    "monthlyProgramPrice",
    "desiredSessionPrice",
  ];
  for (const field of priceFields) {
    const raw = data[field];
    if (raw !== undefined && raw !== null && raw !== "") {
      const num = Number(raw);
      if (Number.isNaN(num) || num < 0) {
        throw new Error(`${field} phải là số không âm`);
      }
    }
  }
}

/** C1-08: a phone number that is present must look like one (empty/absent is fine for a draft; submit requires it). */
function validatePhoneField(data: any): void {
  const raw = data?.phoneNumber;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return;
  if (!isValidPhoneNumber(raw)) throw httpError(PHONE_INVALID_MESSAGE, 400, "INVALID_PHONE_NUMBER");
}

/**
 * N13B-05: years of experience is stored as a string. Accepted: a whole number 0-60 ("3", 3), or one of the five band tokens the web select and the
 * mobile chips send ("<1", "1-3", "3-5", "5-10", "10+"). Free text ("abc") and fractions ("3.5") are refused. Empty / absent is fine for a draft
 * (submit requires it).
 */
const EXPERIENCE_BANDS = new Set(["<1", "1-3", "3-5", "5-10", "10+"]);
export function validateYearsOfExperienceField(data: any): void {
  const raw = data?.yearsOfExperience;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const isWholeNumber = /^\d{1,2}$/.test(text) && Number(text) >= 0 && Number(text) <= 60;
  if (isWholeNumber || EXPERIENCE_BANDS.has(text)) return;
  throw httpError("Số năm kinh nghiệm phải là số nguyên từ 0 đến 60", 400, "INVALID_YEARS_OF_EXPERIENCE");
}

async function syncRoleToPT(userId: string): Promise<void> {
  try {
    await authServiceClient.internalPatch(
      `/auth/internal/users/${userId}/role`,
      { role: "PT" },
      { timeoutMs: 5000 },
    );
  } catch (err: any) {
    // The applicant has no login account in auth-service (e.g. a seeded profile that only exists in
    // this service). Say so, instead of surfacing "auth-service responded 4xx/5xx" to the admin.
    if (err?.response?.status === 404) {
      throw new Error("Hồ sơ này chưa có tài khoản đăng nhập (auth-service không tìm thấy người dùng) nên không thể duyệt thành PT.");
    }
    throw err;
  }
}

export const ptApplicationService = {
  async getMe(userId: string) {
    const app = await ptApplicationRepository.findByUserId(userId);
    if (app) {
      const signed = signPtApplicationDocumentUrls(app);
      // Q1: show the applicant how many tries are left.
      const rejectionCount = await countPtApplicationRejections(userId, app.status);
      (signed as any).rejectionCount = rejectionCount;
      (signed as any).maxRejections = MAX_PT_APPLICATION_REJECTIONS;
      (signed as any).remainingAttempts = Math.max(0, MAX_PT_APPLICATION_REJECTIONS - rejectionCount);
      // B7a: Read availability directly from PTAvailability instead of PTApplication
      const avail = await availabilityService.getAvailability(userId);
      (signed as any).availabilityBlocks = avail.map((a: any) => ({
        dayOfWeek: a.dayOfWeek,
        startTime: a.startTime,
        endTime: a.endTime,
      }));
      return signed;
    }
    return app;
  },

  async saveDraft(userId: string, data: any) {
    // C4-03: a freshly registered account has no UserProfile row yet (the profile is only written when the
    // user fills in onboarding), but applying to be a trainer must not depend on that. Create the minimal
    // empty profile on demand - upsert, so two simultaneous first requests cannot collide, and the
    // onboarding flag stays false so the normal onboarding is still offered afterwards.
    const profile =
      (await profileRepository.findByUserId(userId)) ?? (await profileRepository.upsert(userId, {}));

    // Check if user is already PT
    if (profile.isPT) throw new Error("Bạn đã là huấn luyện viên");

    // Check if there is already a non-DRAFT/NEEDS_MORE_INFO application
    const existing = await ptApplicationRepository.findByUserId(userId);
    // Q1: a rejected applicant may start over (REJECTED -> DRAFT below), until the account has been rejected
    // MAX_PT_APPLICATION_REJECTIONS times.
    await assertRejectionLimitNotReached(userId, existing?.status);
    if (existing && !["DRAFT", "NEEDS_MORE_INFO", "REJECTED"].includes(existing.status)) {
      throw new Error(
        "Không thể sửa bản nháp khi đơn ứng tuyển đang được xét duyệt hoặc đã có kết quả",
      );
    }

    // Validate location data if provided
    await validateLocationData(data);
    await validatePriceFields(data);
    validatePhoneField(data);
    validateYearsOfExperienceField(data);
    if (typeof data?.yearsOfExperience === "number") data.yearsOfExperience = String(data.yearsOfExperience);

    // B7a: Save availability to PTAvailability directly
    if (data.availabilityBlocks) {
      await availabilityService.setAvailability(userId, data.availabilityBlocks);
      // Remove from data so it doesn't pollute the JSON field in PTApplication
      delete data.availabilityBlocks;
    }

    const saved = await ptApplicationRepository.upsertDraft(profile.id, data);
    if (existing?.status === PTApplicationStatus.REJECTED) {
      // The new attempt: reopen the same row as a fresh DRAFT. The old reason stays in the audit trail.
      await ptApplicationRepository.updateStatus(existing.id, PTApplicationStatus.DRAFT, {
        rejectionReason: null,
        adminNote: null,
        reviewedAt: null,
        reviewedByUserId: null,
        approvedAt: null,
        submittedAt: null,
      });
      return ptApplicationRepository.findByUserId(userId);
    }
    return saved;
  },

  /**
   * Submit the application. D25: the applicant must have confirmed the CURRENT PT terms - either already (a row for
   * this version) or by sending `termsVersion` equal to the current version with this call (the ticked box), which is
   * then recorded as source APPLICATION. Without either the submission is refused (409 PT_TERMS_NOT_ACCEPTED) and the
   * application stays as it was.
   */
  async submit(
    userId: string,
    opts: { termsVersion?: string; meta?: { ipAddress?: string | null; userAgent?: string | null } } = {},
  ) {
    const app = await ptApplicationRepository.findByUserId(userId);
    if (!app) throw new Error("Chưa có đơn ứng tuyển nào để nộp");
    await assertRejectionLimitNotReached(userId, app.status);
    if (!["DRAFT", "NEEDS_MORE_INFO", "REJECTED"].includes(app.status)) {
      throw new Error("Đơn ứng tuyển đã được nộp hoặc đã có kết quả");
    }

    // Basic validation before submission
    const requiredFields = [
      "phoneNumber",
      "nationalIdNumber",
      "currentAddress",
      "idCardFrontUrl",
      "idCardBackUrl",
      "portraitPhotoUrl",
      "yearsOfExperience",
      "serviceMode",
    ];

    for (const field of requiredFields) {
      if (!(app as any)[field]) {
        throw new Error(`Thiếu thông tin bắt buộc để nộp đơn: ${field}`);
      }
    }
    // A draft saved before the format check existed may still hold a junk number.
    validatePhoneField({ phoneNumber: app.phoneNumber });

    if (app.mainSpecialties.length === 0) {
      throw new Error("Cần chọn ít nhất một chuyên môn");
    }

    // Pricing validation — mode-based
    const mode = app.serviceMode;
    if (mode === "ONLINE") {
      const p = app.onlinePricePerSession ?? app.desiredSessionPrice ?? 0;
      if (p <= 0) throw new Error("Cần nhập giá per-session ONLINE > 0");
    } else if (mode === "OFFLINE") {
      const p = app.offlinePricePerSession ?? app.desiredSessionPrice ?? 0;
      if (p <= 0) throw new Error("Cần nhập giá per-session OFFLINE > 0");
    } else if (mode === "HYBRID") {
      if (!((app.onlinePricePerSession ?? 0) > 0))
        throw new Error("Cần nhập giá per-session ONLINE > 0");
      if (!((app.offlinePricePerSession ?? 0) > 0))
        throw new Error("Cần nhập giá per-session OFFLINE > 0");
    } else {
      const hasAny =
        (app.desiredSessionPrice ?? 0) > 0 ||
        (app.onlinePricePerSession ?? 0) > 0 ||
        (app.offlinePricePerSession ?? 0) > 0;
      if (!hasAny)
        throw new Error("Cần nhập ít nhất một mức giá per-session > 0");
    }

    // Package price: nếu nhập thì > 0
    const pkgFields: [string, number | null][] = [
      ["onlinePackagePrice", app.onlinePackagePrice],
      ["offlinePackagePrice", app.offlinePackagePrice],
      ["packagePrice", app.packagePrice],
    ];
    for (const [field, val] of pkgFields) {
      if (val != null && val <= 0) throw new Error(`${field} phải > 0`);
    }
    const hasAnyPkg =
      (app.onlinePackagePrice ?? 0) > 0 ||
      (app.offlinePackagePrice ?? 0) > 0 ||
      (app.packagePrice ?? 0) > 0;
    if (hasAnyPkg && (!app.sessionsPerPackage || app.sessionsPerPackage <= 0)) {
      throw new Error("sessionsPerPackage phải > 0 khi có package price");
    }

    // OFFLINE/HYBRID: require at least 1 valid training location at submit time
    if (mode === "OFFLINE" || mode === "HYBRID") {
      const rawLocs: any[] = (app as any).applicationTrainingLocations ?? [];
      const validLocs = rawLocs.filter(
        (loc: any) =>
          loc?.provinceCode &&
          (loc?.gymName?.trim() || loc?.addressLine?.trim()),
      );
      if (validLocs.length === 0) {
        throw new Error(
          "Dịch vụ Offline/Hybrid cần ít nhất 1 nơi luyện tập hợp lệ (chọn tỉnh và tên phòng gym hoặc địa chỉ)",
        );
      }
    }

    // D25 - last gate (every other validation has passed): record the confirmation the applicant just gave, or
    // require one already on file. A wrong/old version is refused with the current one in the body.
    if (!(await ptTermsService.hasAcceptedCurrent(userId))) {
      if (opts.termsVersion === undefined) {
        throw Object.assign(
          new Error("Bạn cần đồng ý Điều khoản dành cho Huấn luyện viên trước khi nộp hồ sơ."),
          { status: 409, code: PT_TERMS_NOT_ACCEPTED, termsVersion: PT_TERMS_VERSION },
        );
      }
      await ptTermsService.accept(userId, opts.termsVersion, "APPLICATION", opts.meta);
    }

    const updated = await ptApplicationRepository.updateStatus(
      app.id,
      PTApplicationStatus.SUBMITTED,
      {
        submittedAt: new Date(),
        // A re-submission after a rejection starts clean (the rejection stays in the audit trail).
        ...(app.status === "REJECTED"
          ? { rejectionReason: null, adminNote: null, reviewedAt: null, reviewedByUserId: null, approvedAt: null }
          : {}),
      },
    );

    // Notify admin real-time (fire-and-forget, not persisted to DB)
    // TODO: persist to DB when user-service can query admin user IDs (role is auth-service only)
    axios
      .post(
        `${CHAT_SERVICE_URL}/internal/push-notification`,
        {
          adminBroadcast: true,
          notification: {
            id: `pt-app-${updated.id}`,
            text: "Có hồ sơ PT mới cần xét duyệt",
            eventType: "PT_APPLICATION_SUBMITTED",
            entityType: "PT_APPLICATION",
            entityId: updated.id,
            link: "/admin/pt-applications",
            unread: true,
            createdAt: new Date().toISOString(),
          },
        },
        {
          timeout: 3000,
          headers: { "x-internal-secret": INTERNAL_API_SECRET },
        },
      )
      .catch((err: any) =>
        logger.warn({ err }, "Failed to push admin realtime notification"),
      );

    ptApplicationsTotal.inc({ status: "SUBMITTED" });
    return updated;
  },

  async adminReviewAction(id: string, action: string, payload: any, reviewerUserId: string) {
    const app = await ptApplicationRepository.findById(id);
    if (!app) throw httpError("Không tìm thấy đơn ứng tuyển", 404, "PT_APPLICATION_NOT_FOUND");

    // Normalize action names (frontend may send short forms)
    const actionAliases: Record<string, string> = {
      APPROVE: "APPROVED",
      REJECT: "REJECTED",
      REQUEST_INFO: "NEEDS_MORE_INFO",
    };
    const normalizedAction = actionAliases[action] || action;

    const statusMap: Record<string, PTApplicationStatus> = {
      UNDER_REVIEW: PTApplicationStatus.UNDER_REVIEW,
      NEEDS_MORE_INFO: PTApplicationStatus.NEEDS_MORE_INFO,
      APPROVED: PTApplicationStatus.APPROVED,
      REJECTED: PTApplicationStatus.REJECTED,
    };

    const status = statusMap[normalizedAction];
    if (!status) throw httpError(`Hành động không hợp lệ: ${action}`, 400, "INVALID_REVIEW_ACTION");

    // B08: approving an application that is already APPROVED is a no-op that answers with the current
    // state - no second role sync, no location rewrite, no new "approved" notification, no overwritten
    // reviewer/approval timestamps.
    if (normalizedAction === "APPROVED" && app.status === PTApplicationStatus.APPROVED) {
      return signPtApplicationDocumentUrls(await enrichWithUserInfo(app));
    }

    // Q2: the state machine - an invalid move is a 409 and nothing is written (no role sync, no notice).
    assertAdminTransition(app.status, status);

    // Money-flow plan 5.5: WHO acted, recorded on every review action — not just approval —
    // so a rejection or a request-for-more-info carries the same accountability an approval
    // does. reviewerUserId comes from the caller's own verified identity (req.user.id at the
    // controller), never from the request body.
    const extra: any = { reviewedAt: new Date(), reviewedByUserId: reviewerUserId };

    if (normalizedAction === "REJECTED") {
      if (!payload.rejectionReason)
        throw new Error("Cần nhập lý do từ chối");
      extra.rejectionReason = payload.rejectionReason;
    }

    if (normalizedAction === "NEEDS_MORE_INFO") {
      if (!payload.adminNote)
        throw new Error("Cần nhập nội dung yêu cầu bổ sung thông tin");
      extra.adminNote = payload.adminNote;
    }

    if (normalizedAction === "APPROVED") {
      extra.approvedAt = new Date();
      // C4-02: an application that was rejected and is now approved must not keep showing the old
      // rejection reason beside "approved". The reason is not lost: it was stored with the applicant's
      // rejection notification (and the reviewer id is on every action); the log below records what
      // was cleared.
      if (app.rejectionReason) {
        extra.rejectionReason = null;
        logger.info(
          { applicationId: id, reviewerUserId, clearedRejectionReason: app.rejectionReason },
          "PT application approved: previous rejection reason cleared from the application",
        );
      }

      // Perform role sync and profile update
      await syncRoleToPT(app.userProfile.userId);
      await profileRepository.setIsPT(app.userProfile.userId, true);
      await assignReferralCodeIfMissing(app.userProfile.userId);

      // A new trainer must be findable by name: copy it from auth-service into the profile's
      // own (searchable) columns if they are still empty. Best-effort — approval never fails on it.
      if (!app.userProfile.firstName && !app.userProfile.lastName) {
        const authInfo = await fetchAuthUserInfo(app.userProfile.userId);
        const names = profileNameFields(authInfo?.firstName, authInfo?.lastName);
        if (names) {
          await profileRepository
            .backfillNames(app.userProfile.userId, names)
            .catch((err: any) => logger.warn({ err: err?.message }, "PT approval: could not backfill profile name"));
        }
      }

      // The admin search finds a trainer by email too (ADM-01): keep the auth email in the profile while it is empty. Best-effort.
      if (!app.userProfile.email) {
        const authInfo = await fetchAuthUserInfo(app.userProfile.userId);
        persistMissingProfileEmail(app.userProfile, authInfo?.email);
      }

      // Create PTTrainingLocation records from application (idempotent)
      const rawLocations: any[] =
        (app as any).applicationTrainingLocations ?? [];
      if (rawLocations.length > 0) {
        await prisma.$transaction(async (tx) => {
          // MVP: hard delete locations generated from previous approve retries
          await tx.pTTrainingLocation.deleteMany({
            where: { ptUserId: app.userProfile.userId },
          });

          // Normalize primary: only one isPrimary=true
          const primaryIdx = rawLocations.findIndex(
            (l: any) => l.isPrimary === true,
          );
          const resolvedPrimaryIdx = primaryIdx >= 0 ? primaryIdx : 0;

          await tx.pTTrainingLocation.createMany({
            data: rawLocations.map((loc: any, i: number) => {
              const coords = parseOptionalVnCoords(loc.latitude, loc.longitude);
              return {
                ptUserId: app.userProfile.userId,
                provinceCode: Number(loc.provinceCode),
                wardCode: loc.wardCode ? Number(loc.wardCode) : null,
                gymName: loc.gymName ?? null,
                addressLine: loc.addressLine ?? null,
                legacyDistrictName: loc.legacyDistrictName ?? null,
                latitude: coords.present ? coords.latitude : null,
                longitude: coords.present ? coords.longitude : null,
                isPrimary: i === resolvedPrimaryIdx,
                isActive: true,
                note: loc.note ?? null,
              };
            }),
          });
        });
      }
    }

    ptApplicationsTotal.inc({ status: normalizedAction });
    if (normalizedAction === "REJECTED") {
      // Q1: one durable row per rejection - this is what the 3-strikes limit counts. Written BEFORE the status
      // change and allowed to throw, so a rejection can never be recorded as a status without being counted.
      await ptApplicationRepository.recordRejectionAudit({
        action: PT_APPLICATION_REJECTED_AUDIT,
        reviewerUserId,
        applicantUserId: app.userProfile.userId,
        applicationId: id,
        rejectionReason: extra.rejectionReason,
      });
    }
    await ptApplicationRepository.updateStatus(id, status, extra);

    // Tell the applicant — the result they were promised a notification for.
    const notice = ptApplicationReviewNotice(normalizedAction, extra.rejectionReason ?? undefined);
    if (notice) {
      // Stored as well as pushed, so an applicant who was offline still finds the result in
      // their notification list. Never allowed to fail the review itself.
      await notificationService
        .create({
          userId: app.userProfile.userId,
          text: notice.text,
          eventType: "PT_APPLICATION_REVIEWED",
          entityType: "PT_APPLICATION",
          entityId: id,
          link: notice.link,
        })
        .catch(() => undefined);
    }
    // Fetch full application with userProfile and enrich with auth-service data
    const updated = await ptApplicationRepository.findById(id);
    if (!updated) throw httpError("Không tìm thấy đơn ứng tuyển", 404, "PT_APPLICATION_NOT_FOUND");
    return signPtApplicationDocumentUrls(await enrichWithUserInfo(updated));
  },

  async countApplications(filters: any) {
    return ptApplicationRepository.countAll(filters);
  },

  /** `paging` omitted: every matching application, as before (C1-10 keeps existing callers working). */
  async listApplications(filters: any, paging?: { page: number; limit: number }) {
    const apps = await ptApplicationRepository.findAll(filters, paging);
    // Enrich all applications with user info from auth-service (in parallel). One row that cannot be
    // enriched or have its document links signed must never take the whole admin list down (B01): it is
    // logged and returned without enrichment instead.
    return Promise.all(
      apps.map(async (app: any) => {
        try {
          return signPtApplicationDocumentUrls(await enrichWithUserInfo(app));
        } catch (err: any) {
          logger.error(
            { err: err?.message, applicationId: app?.id },
            "listApplications: row could not be prepared, returned unenriched",
          );
          return withoutInternalProfileFields(app);
        }
      }),
    );
  },

  async getById(id: string) {
    const app = await ptApplicationRepository.findById(id);
    if (!app) return null;
    
    const enriched = signPtApplicationDocumentUrls(await enrichWithUserInfo(app));
    // B7b: Attach availability blocks from PTAvailability for admin
    const avail = await availabilityService.getAvailability(app.userProfile.userId);
    (enriched as any).availabilityBlocks = avail.map((a: any) => ({
      dayOfWeek: a.dayOfWeek,
      startTime: a.startTime,
      endTime: a.endTime,
    }));
    return enriched;
  },
};
