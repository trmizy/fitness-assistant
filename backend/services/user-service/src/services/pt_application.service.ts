import axios from "axios";
import { logger } from "@gym-coach/shared";
import { ptApplicationRepository } from "../repositories/pt_application.repository";
import { profileRepository } from "../repositories/profile.repository";
import { PrismaClient, PTApplicationStatus } from "../generated/prisma";
import { ptApplicationsTotal } from "@gym-coach/shared";

const prisma = new PrismaClient();

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:3001";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ||
  "dev_internal_service_secret_change_in_production";

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
    const { data } = await axios.get(
      `${AUTH_SERVICE_URL}/auth/internal/users/${userId}`,
      {
        headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
        timeout: 3000,
      },
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
async function enrichWithUserInfo(app: any): Promise<any> {
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
  await axios.patch(
    `${AUTH_SERVICE_URL}/auth/internal/users/${userId}/role`,
    { role: "PT" },
    {
      headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
      timeout: 5000,
    },
  );
}

export const ptApplicationService = {
  async getMe(userId: string) {
    return ptApplicationRepository.findByUserId(userId);
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

    return ptApplicationRepository.upsertDraft(profile.id, data);
  },

  async submit(userId: string) {
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

  async adminReviewAction(id: string, action: string, payload: any) {
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

    const extra: any = { reviewedAt: new Date() };

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
    // Fetch full application with userProfile and enrich with auth-service data
    const updated = await ptApplicationRepository.findById(id);
    if (!updated) throw new Error("Application not found after update");
    return enrichWithUserInfo(updated);
  },

  async listApplications(filters: any) {
    const apps = await ptApplicationRepository.findAll(filters);
    // Enrich all applications with user info from auth-service (in parallel)
    return Promise.all(apps.map(enrichWithUserInfo));
  },

  async getById(id: string) {
    const app = await ptApplicationRepository.findById(id);
    if (!app) return null;
    return enrichWithUserInfo(app);
  },
};
