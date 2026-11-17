import api, { uploadFileToPresignedUrl, type PresignedUploadTarget } from "./api";

function ptDocumentContentType(file: File): string {
  const explicit = file.type?.trim();
  if (explicit) return explicit;
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  return "application/pdf";
}

/** The backend's "no upload bucket on this deployment" refusal: 503 + code UPLOAD_STORAGE_NOT_CONFIGURED. */
export function isUploadStorageNotConfigured(e: any): boolean {
  if (e?.response?.status !== 503) return false;
  const data = e.response.data;
  return (
    data?.code === "UPLOAD_STORAGE_NOT_CONFIGURED" ||
    /not configured/i.test(String(data?.error ?? ""))
  );
}

export interface PTApplicationCertificate {
  id?: string;
  certificateName: string;
  issuingOrganization: string;
  isCurrentlyValid: boolean;
  certificationStatus?: string; // 'Valid' | 'Expired' | 'Lifetime'
  issueDate?: string;
  expirationDate?: string;
  certificateFileUrl?: string;
}

export interface PTApplication {
  id: string;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "NEEDS_MORE_INFO"
    | "APPROVED"
    | "REJECTED";
  phoneNumber?: string;
  nationalIdNumber?: string;
  currentAddress?: string;
  idCardFrontUrl?: string;
  idCardBackUrl?: string;
  portraitPhotoUrl?: string;
  yearsOfExperience?: string;
  educationBackground?: string;
  previousWorkExperience?: string;
  professionalBio?: string;
  mainSpecialties: string[];
  targetClientGroups: string[];
  primaryTrainingGoals: string[];
  trainingMethodsApproach?: string;
  portfolioUrl?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  socialLinks?: any;
  availabilityNotes?: string;
  availableTimeSlots?: any;
  serviceMode?: "ONLINE" | "OFFLINE" | "HYBRID";
  operatingAreas?: string[];
  desiredSessionPrice?: number;
  availableDays: string[];
  availableFrom?: string;
  availableUntil?: string;
  availabilityBlocks?: any[];
  sessionDurationMinutes?: number;
  gymAffiliation?: string;
  packagePrice?: number;
  sessionsPerPackage?: number;
  monthlyProgramPrice?: number;
  additionalPricingNotes?: string;
  onlinePricePerSession?: number;
  offlinePricePerSession?: number;
  onlinePackagePrice?: number;
  offlinePackagePrice?: number;
  residenceProvinceCode?: number;
  residenceWardCode?: number;
  residenceAddressLine?: string;
  residenceLegacyDistrictName?: string;
  applicationTrainingLocations?: {
    provinceCode: number;
    wardCode?: number;
    gymName?: string;
    addressLine?: string;
    legacyDistrictName?: string;
    isPrimary?: boolean;
    note?: string;
  }[];
  otherReferences?: string;
  adminNote?: string;
  rejectionReason?: string;
  /** Số lần tài khoản đã bị từ chối đơn PT, giới hạn tối đa và số lần còn lại (backend tính, chỉ có ở GET /pt-applications/me). */
  rejectionCount?: number;
  maxRejections?: number;
  remainingAttempts?: number;
  submittedAt?: string;
  reviewedAt?: string;
  approvedAt?: string;
  certificates: PTApplicationCertificate[];
  media: any[];
  user?: {
    /** The PT's account id (the profile's userId) - what the admin PT suspension routes take. */
    userId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  updatedAt: string;
  createdAt: string;
}

/** D25 - the PT terms exactly as the server serves them (one versioned source) plus this user's standing. */
export interface PtTerms {
  version: string;
  isDraft: boolean;
  title: string;
  intro: string;
  sections: { id: string; title: string; body: string[] }[];
  accepted: boolean;
  acceptedAt: string | null;
  previouslyAcceptedVersion: string | null;
  mustReconfirm: boolean;
}

/**
 * The admin endpoints answer with `user` = {firstName,lastName,email} only; the account id (what the PT suspension card
 * needs) lives on `userProfile.userId`. Keep the name/email from `user` and add the account id (N15B-04, found in verify).
 */
function adminAppUser(app: any) {
  const base = app.user ?? app.userProfile;
  const userId = app.user?.userId ?? app.userProfile?.userId;
  return base && userId ? { ...base, userId } : base;
}

/** Rows the queue badges read (server maximum page size). A queue at this size shows "≥200". */
export const ADMIN_QUEUE_READ_CAP = 200;

export const ptApplicationService = {
  getTerms: async (): Promise<PtTerms> => {
    const { data } = await api.get("/pt-applications/terms");
    return data;
  },

  /** Confirm the version the user just read. A stale version is refused (409) - re-open the terms. */
  acceptTerms: async (version: string): Promise<{ version: string; acceptedAt: string; accepted: true }> => {
    const { data } = await api.post("/pt-applications/terms/accept", { version });
    return data;
  },

  getMe: async (): Promise<PTApplication | null> => {
    try {
      const { data } = await api.get("/pt-applications/me");
      return data;
    } catch (error) {
      console.error("Error fetching PT application:", error);
      return null;
    }
  },

  saveDraft: async (data: Partial<PTApplication>): Promise<PTApplication> => {
    const { data: response } = await api.post(
      "/pt-applications/me/draft",
      data,
    );
    return response;
  },

  /** `termsVersion`: the version of the terms whose box the applicant ticked (D25) - the server records it. */
  submit: async (termsVersion?: string): Promise<PTApplication> => {
    const { data: response } = await api.post("/pt-applications/me/submit", termsVersion ? { termsVersion } : {});
    return response;
  },

  uploadDocument: async (
    file: File,
  ): Promise<{ url: string; previewUrl?: string; filename: string }> => {
    const contentType = ptDocumentContentType(file);
    let target: PresignedUploadTarget;
    try {
      const res = await api.post<PresignedUploadTarget>(
        "/pt-applications/me/upload/presign",
        { contentType },
      );
      target = res.data;
    } catch (e: any) {
      // Local dev stack has no upload bucket (503 UPLOAD_STORAGE_NOT_CONFIGURED /
      // "USER_UPLOAD_BUCKET is not configured"); the multipart route is the only one that works
      // there. AWS never hits this branch (presign succeeds, and the multipart route is disabled
      // there), and any other error is still thrown.
      if (!isUploadStorageNotConfigured(e)) throw e;
      const form = new FormData();
      form.append("document", file);
      const { data } = await api.post("/pt-applications/me/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return { ...data, filename: file.name };
    }
    await uploadFileToPresignedUrl(target, file, contentType);
    const { data } = await api.post("/pt-applications/me/upload/confirm", {
      key: target.key,
    });
    return { ...data, filename: file.name };
  },

  // Admin methods
  /**
   * A bounded read for the work-queue badges ("Hôm nay", sidebar): newest first, at most ADMIN_QUEUE_READ_CAP rows of the
   * given status. The server never answers more than one page; callers that show a list use listApplicationsPage.
   */
  listApplications: async (params: any = {}): Promise<PTApplication[]> => {
    const { data } = await api.get("/pt-applications/admin", { params: { page: 1, limit: ADMIN_QUEUE_READ_CAP, ...params } });
    return data.map((app: any) => ({
      ...app,
      user: adminAppUser(app),
    }));
  },

  /**
   * FIX5-ADMIN-PERF: ONE page of the admin list (status filter + applicant name/email search `q` run in the
   * database). The body stays the plain array; the total travels in the `X-Total-Count` header.
   */
  listApplicationsPage: async (params: {
    status?: string;
    q?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: PTApplication[]; total: number }> => {
    const query: Record<string, string | number> = { page: params.page, limit: params.limit };
    if (params.status) query.status = params.status;
    if (params.q && params.q.trim()) query.q = params.q.trim();
    const res = await api.get("/pt-applications/admin", { params: query });
    const rows: PTApplication[] = (Array.isArray(res.data) ? res.data : []).map((app: any) => ({
      ...app,
      user: adminAppUser(app),
    }));
    const header = Number(res.headers?.["x-total-count"]);
    return { rows, total: Number.isFinite(header) && header >= 0 ? header : rows.length };
  },

  getById: async (id: string): Promise<PTApplication> => {
    const { data } = await api.get(`/pt-applications/admin/${id}`);
    return { ...data, user: adminAppUser(data) };
  },

  reviewAction: async (
    id: string,
    action: string,
    payload: any = {},
  ): Promise<PTApplication> => {
    const { data } = await api.post(
      `/pt-applications/admin/${id}/review/${action}`,
      payload,
    );
    return { ...data, user: adminAppUser(data) };
  },
};
