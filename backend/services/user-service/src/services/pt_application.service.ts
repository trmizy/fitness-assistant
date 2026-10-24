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

const prisma = new PrismaClient();

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

async function syncRoleToPT(userId: string): Promise<void> {
  await authServiceClient.internalPatch(
    `/auth/internal/users/${userId}/role`,
    { role: "PT" },
    { timeoutMs: 5000 },
  );
}

export const ptApplicationService = {
  async getMe(userId: string) {
    const app = await ptApplicationRepository.findByUserId(userId);
    if (app) {
      const signed = signPtApplicationDocumentUrls(app);
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
    const profile = await profileRepository.findByUserId(userId);
    if (!profile) throw new Error("User profile not found");

    // Check if user is already PT
    if (profile.isPT) throw new Error("User is already a Personal Trainer");

    // Check if there is already a non-DRAFT/NEEDS_MORE_INFO application
    const existing = await ptApplicationRepository.findByUserId(userId);
    if (existing && !["DRAFT", "NEEDS_MORE_INFO"].includes(existing.status)) {
      throw new Error(
        `Cannot save draft while application is in ${existing.status} status`,
      );
    }

    // Validate location data if provided
    await validateLocationData(data);
    await validatePriceFields(data);

    // B7a: Save availability to PTAvailability directly
    if (data.availabilityBlocks) {
      await availabilityService.setAvailability(userId, data.availabilityBlocks);
      // Remove from data so it doesn't pollute the JSON field in PTApplication
      delete data.availabilityBlocks;
    }

    return ptApplicationRepository.upsertDraft(profile.id, data);
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
    if (!app) throw new Error("No application found to submit");
    if (!["DRAFT", "NEEDS_MORE_INFO"].includes(app.status)) {
      throw new Error("Application is already submitted or processed");
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
        throw new Error(`Missing required field for submission: ${field}`);
      }
    }

    if (app.mainSpecialties.length === 0) {
      throw new Error("At least one specialty is required");
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
    if (!app) throw new Error("Application not found");

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
    if (!status) throw new Error(`Invalid action: ${action}`);

    // B08: approving an application that is already APPROVED is a no-op that answers with the current
    // state - no second role sync, no location rewrite, no new "approved" notification, no overwritten
    // reviewer/approval timestamps. A REJECTED application may still be re-approved (the deliberate
    // "reconsider" path): that is a real transition and runs in full.
    if (normalizedAction === "APPROVED" && app.status === PTApplicationStatus.APPROVED) {
      return signPtApplicationDocumentUrls(await enrichWithUserInfo(app));
    }

    // Money-flow plan 5.5: WHO acted, recorded on every review action — not just approval —
    // so a rejection or a request-for-more-info carries the same accountability an approval
    // does. reviewerUserId comes from the caller's own verified identity (req.user.id at the
    // controller), never from the request body.
    const extra: any = { reviewedAt: new Date(), reviewedByUserId: reviewerUserId };

    if (normalizedAction === "REJECTED") {
      if (!payload.rejectionReason)
        throw new Error("Rejection reason is required");
      extra.rejectionReason = payload.rejectionReason;
    }

    if (normalizedAction === "NEEDS_MORE_INFO") {
      if (!payload.adminNote)
        throw new Error("Admin feedback is required for NEEDS_MORE_INFO");
      extra.adminNote = payload.adminNote;
    }

    if (normalizedAction === "APPROVED") {
      extra.approvedAt = new Date();

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
            data: rawLocations.map((loc: any, i: number) => ({
              ptUserId: app.userProfile.userId,
              provinceCode: Number(loc.provinceCode),
              wardCode: loc.wardCode ? Number(loc.wardCode) : null,
              gymName: loc.gymName ?? null,
              addressLine: loc.addressLine ?? null,
              legacyDistrictName: loc.legacyDistrictName ?? null,
              isPrimary: i === resolvedPrimaryIdx,
              isActive: true,
              note: loc.note ?? null,
            })),
          });
        });
      }
    }

    ptApplicationsTotal.inc({ status: normalizedAction });
    await ptApplicationRepository.updateStatus(id, status, extra);

    // Tell the applicant — the result they were promised a notification for.
    const notice = ptApplicationReviewNotice(normalizedAction);
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
    if (!updated) throw new Error("Application not found after update");
    return signPtApplicationDocumentUrls(await enrichWithUserInfo(updated));
  },

  async listApplications(filters: any) {
    const apps = await ptApplicationRepository.findAll(filters);
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
