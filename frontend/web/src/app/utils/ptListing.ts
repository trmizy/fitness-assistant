/**
 * Listing Management (Phase D1) — the pure half of the PT "Tin đăng" page.
 *
 * Ported from frontend/mobile/src/features/ptListing/ptListing.ts (same wire shapes, same rules). Every
 * shape here was read off user-service, not guessed:
 *  - `GET /profile/me/listing` → pt-listing.service.ts#getListing
 *  - the revision `payload` is the COMPLETE desired state (pt-listing.schemas.ts): 8 profile fields,
 *    `packages[]`, `photoIds[]`, `coverPhotoId`. `PUT .../draft` replaces it wholesale and must carry
 *    `expectedDraftVersion` (409 DRAFT_STALE otherwise); `submit` carries it too (409 LISTING_STALE when
 *    the public listing moved after the draft was based on it).
 *  - photos: at most 5 per listing, cover must be one of them.
 *
 * No React, no browser API: runs under `npx tsx --test`.
 */
import type {
  ListingHistoryItem,
  ListingPhoto,
  ListingSystemAdjustment,
  PtListingLimits,
  PtListingPackageDraft,
  PtListingPayload,
  PtListingPreview,
  PtListingProfileDraft,
  PtListingRevision,
  PtListingView,
  PtPublishedPackage,
} from "../types";

// ── limits ────────────────────────────────────────────────────────────────────────────────────
export const DEFAULT_LIMITS: PtListingLimits = { maxPhotos: 5, maxPackages: 10, maxStagedPhotos: 15 };
/** The server refuses a photo past 8 MB (pt-physique-upload.service.ts MAX_PHOTO_BYTES). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** A closed revision can be copied into a new draft for 30 days only (COPY_FROM_CLOSED_DAYS). */
export const COPY_FROM_CLOSED_DAYS = 30;
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const BIO_MAX = 2000;
const METHODS_MAX = 2000;
const URL_MAX = 300;
const LIST_MAX_ITEMS = 10;
const LIST_ITEM_MAX = 60;
const LANGUAGE_ITEM_MAX = 30;
export const FIELD_LIMITS = { BIO_MAX, METHODS_MAX, URL_MAX, LIST_MAX_ITEMS, LIST_ITEM_MAX, LANGUAGE_ITEM_MAX } as const;

// ── options (values are stored verbatim — same strings the PT application stores) ─────────────
export interface ListingOption {
  value: string;
  label: string;
}

/** Stored verbatim (English), exactly as the PT application form stores them — only the label is Vietnamese. */
export const TARGET_GROUP_OPTIONS: ListingOption[] = [
  { value: "Beginners", label: "Người mới tập" },
  { value: "Weight-loss clients", label: "Người muốn giảm cân" },
  { value: "Postpartum women", label: "Phụ nữ sau sinh" },
  { value: "Advanced trainees", label: "Người tập lâu năm" },
  { value: "Office workers", label: "Dân văn phòng" },
  { value: "Athletes", label: "Vận động viên" },
  { value: "Rehab clients", label: "Người cần phục hồi" },
  { value: "Seniors", label: "Người cao tuổi" },
  { value: "Teens / Youth", label: "Thanh thiếu niên" },
  { value: "Competitive bodybuilders", label: "VĐV thể hình thi đấu" },
];

export const TRAINING_GOAL_OPTIONS: ListingOption[] = [
  { value: "Fat Loss & Body Recomposition", label: "Giảm mỡ & tái cấu trúc cơ thể" },
  { value: "Muscle Building & Hypertrophy", label: "Tăng cơ" },
  { value: "Strength & Powerlifting", label: "Sức mạnh & Powerlifting" },
  { value: "Rehabilitation & Injury Recovery", label: "Phục hồi chấn thương" },
  { value: "Sports Performance", label: "Thành tích thể thao" },
  { value: "General Fitness & Health", label: "Thể lực & sức khoẻ chung" },
];

/** The fixed language chips. Anything else is a custom entry added through "Khác". */
export const LANGUAGE_OPTIONS = ["Tiếng Việt", "English", "中文", "한국어", "日本語"] as const;

/**
 * The options to render for a field: the known list first, then any SAVED value that is not in it
 * (legacy / custom data must stay visible and removable — never silently dropped).
 */
export function optionsWithSaved(known: ListingOption[], saved: string[]): ListingOption[] {
  const have = new Set(known.map((o) => o.value));
  const extra = [...new Set(saved)].filter((v) => v && !have.has(v)).map((v) => ({ value: v, label: v }));
  return [...known, ...extra];
}

/** Languages saved that are not one of the fixed chips (shown as removable custom chips). */
export const customLanguages = (languages: string[]): string[] =>
  languages.filter((l) => !(LANGUAGE_OPTIONS as readonly string[]).includes(l));

// ── normalizers (wire → typed) ────────────────────────────────────────────────────────────────
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
const int = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);

export function normalizeProfile(raw: any): PtListingProfileDraft {
  return {
    professionalBio: str(raw?.professionalBio),
    mainSpecialties: strList(raw?.mainSpecialties),
    trainingMethodsApproach: str(raw?.trainingMethodsApproach),
    targetClientGroups: strList(raw?.targetClientGroups),
    primaryTrainingGoals: strList(raw?.primaryTrainingGoals),
    languages: strList(raw?.languages),
    websiteUrl: str(raw?.websiteUrl),
    linkedinUrl: str(raw?.linkedinUrl),
  };
}

export function normalizePackageDraft(raw: any): PtListingPackageDraft {
  return {
    ...(typeof raw?.id === "string" && raw.id ? { id: raw.id } : {}),
    name: typeof raw?.name === "string" ? raw.name : "",
    description: str(raw?.description),
    price: Number(raw?.price) || 0,
    sessionCount: int(raw?.sessionCount),
    sessionMode: raw?.sessionMode === "ONLINE" ? "ONLINE" : "OFFLINE",
    sessionDurationMinutes: int(raw?.sessionDurationMinutes, 60),
    validityDays: raw?.validityDays == null ? null : int(raw.validityDays),
    isActive: raw?.isActive !== false,
    ...(raw?.archive === true ? { archive: true } : {}),
  };
}

export function normalizePayload(raw: any): PtListingPayload {
  return {
    profile: normalizeProfile(raw?.profile),
    packages: Array.isArray(raw?.packages) ? raw.packages.map(normalizePackageDraft) : [],
    photoIds: strList(raw?.photoIds),
    coverPhotoId: typeof raw?.coverPhotoId === "string" && raw.coverPhotoId ? raw.coverPhotoId : null,
  };
}

export function normalizeRevision(raw: any): PtListingRevision | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    status: raw.status,
    source: String(raw.source ?? "OWNER"),
    parentRevisionId: raw.parentRevisionId ?? null,
    baseVersion: int(raw.baseVersion),
    draftVersion: int(raw.draftVersion, 1),
    payload: normalizePayload(raw.payload),
    systemAdjustments: Array.isArray(raw.systemAdjustments)
      ? raw.systemAdjustments.filter((a: any) => a && typeof a.type === "string")
      : [],
    ownerNote: str(raw.ownerNote),
    reviewNote: str(raw.reviewNote),
    submittedAt: raw.submittedAt ?? null,
    reviewedAt: raw.reviewedAt ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    stale: raw.stale === true,
  };
}

/** A revision as the 200/201 bodies (`{ revision }`) and the 409 bodies carry it. */
export const revisionFromResponse = (body: any): PtListingRevision | null => normalizeRevision(body?.revision);

export function normalizePhoto(raw: any): ListingPhoto | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    status: String(raw.status ?? "PUBLISHED"),
    url: typeof raw.url === "string" ? raw.url : null,
    expiresAt: raw.expiresAt ?? null,
    isCover: raw.isCover === true,
    sortOrder: int(raw.sortOrder),
  };
}

export function normalizeLimits(raw: any): PtListingLimits {
  return {
    maxPhotos: int(raw?.maxPhotos, DEFAULT_LIMITS.maxPhotos) || DEFAULT_LIMITS.maxPhotos,
    maxPackages: int(raw?.maxPackages, DEFAULT_LIMITS.maxPackages) || DEFAULT_LIMITS.maxPackages,
    maxStagedPhotos: int(raw?.maxStagedPhotos, DEFAULT_LIMITS.maxStagedPhotos) || DEFAULT_LIMITS.maxStagedPhotos,
  };
}

export function normalizeHistoryItem(h: any): ListingHistoryItem {
  return {
    id: h.id,
    status: h.status,
    source: h.source,
    parentRevisionId: h.parentRevisionId ?? null,
    baseVersion: typeof h.baseVersion === "number" ? h.baseVersion : undefined,
    reviewNote: str(h.reviewNote),
    submittedAt: h.submittedAt ?? null,
    reviewedAt: h.reviewedAt ?? null,
    closedAt: h.closedAt ?? null,
    createdAt: h.createdAt ?? null,
    adminReason: h.adminReason ?? null,
    reviewedBy: h.reviewedBy ?? null,
    submittedBy: h.submittedBy ?? null,
  };
}

export function normalizeListing(raw: any): PtListingView {
  const published = raw?.published ?? {};
  const payload = normalizePayload(published.payload);
  return {
    listingVersion: int(raw?.listingVersion),
    listingPublishedAt: raw?.listingPublishedAt ?? null,
    published: {
      profile: payload.profile,
      packages: (Array.isArray(published.packages) ? published.packages : [])
        .map((p: any) => ({ ...normalizePackageDraft(p), id: String(p?.id ?? ""), version: int(p?.version, 1) }))
        .filter((p: PtPublishedPackage) => p.id),
      photos: (Array.isArray(published.photos) ? published.photos : []).map(normalizePhoto).filter(Boolean) as ListingPhoto[],
      coverPhotoId: payload.coverPhotoId,
    },
    openRevision: normalizeRevision(raw?.openRevision),
    photos: (Array.isArray(raw?.photos) ? raw.photos : []).map(normalizePhoto).filter(Boolean) as ListingPhoto[],
    history: (Array.isArray(raw?.history) ? raw.history : []).filter((h: any) => h && typeof h.id === "string").map(normalizeHistoryItem),
    limits: normalizeLimits(raw?.limits),
  };
}

// ── what the trainer sees: one status, not seven enums ────────────────────────────────────────
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ListingStatusView {
  key: "NONE" | "DRAFT" | "PENDING" | "CHANGES_REQUESTED" | "REJECTED" | "APPROVED";
  label: string | null;
  tone: StatusTone;
  /** One sentence in the trainer's words. */
  description: string;
  /** What the admin wrote (changes requested / rejected). */
  adminNote: string | null;
  /** Extra lines (the server rebuilt the draft for the trainer). */
  notices: string[];
  /** The public listing moved after this draft/submission was started. */
  stale: boolean;
}

export function adjustmentNotice(a: ListingSystemAdjustment): string | null {
  switch (a.type) {
    case "PHOTO_NO_LONGER_AVAILABLE":
      return "Một ảnh không còn dùng được nên đã được gỡ khỏi bản nháp.";
    case "PACKAGE_NO_LONGER_AVAILABLE":
      return typeof a.name === "string" && a.name
        ? `Gói "${a.name}" không còn được bán nên đã được gỡ khỏi bản nháp.`
        : "Một gói không còn được bán nên đã được gỡ khỏi bản nháp.";
    case "REBASED_AFTER_ADMIN_EDIT":
      return "Quản trị viên vừa cập nhật tin đăng của bạn. Nội dung bạn soạn đã được giữ lại — hãy xem lại rồi gửi duyệt lại.";
    default:
      return null;
  }
}

export function listingStatusView(view: Pick<PtListingView, "openRevision" | "history">): ListingStatusView {
  const open = view.openRevision;
  const notices = (open?.systemAdjustments ?? []).map(adjustmentNotice).filter((n): n is string => !!n);

  if (open?.status === "PENDING") {
    return {
      key: "PENDING",
      label: "Chờ duyệt",
      tone: "info",
      description: "Bản sửa đã gửi cho quản trị viên. Khách vẫn thấy tin đăng hiện tại cho tới khi bản sửa được duyệt.",
      adminNote: null,
      notices,
      stale: open.stale,
    };
  }
  if (open?.status === "DRAFT") {
    if (open.reviewNote) {
      return {
        key: "CHANGES_REQUESTED",
        label: "Cần chỉnh sửa",
        tone: "warning",
        description: "Quản trị viên đề nghị bạn chỉnh sửa trước khi duyệt. Sửa theo ghi chú rồi gửi duyệt lại.",
        adminNote: open.reviewNote,
        notices,
        stale: open.stale,
      };
    }
    return {
      key: "DRAFT",
      label: "Đang soạn",
      tone: "neutral",
      description: "Đây là bản nháp, chỉ mình bạn thấy. Khách chỉ thấy tin đăng hiện tại cho tới khi bản sửa được gửi và duyệt.",
      adminNote: null,
      notices,
      stale: open.stale,
    };
  }
  const last = view.history[0];
  if (last?.status === "REJECTED") {
    return {
      key: "REJECTED",
      label: "Bị từ chối",
      tone: "danger",
      description: "Bản sửa gần nhất bị từ chối. Tin đăng hiện tại của bạn vẫn hiển thị bình thường.",
      adminNote: last.reviewNote,
      notices: [],
      stale: false,
    };
  }
  if (last?.status === "APPROVED") {
    return {
      key: "APPROVED",
      label: "Đã duyệt",
      tone: "success",
      description: "Bản sửa gần nhất đã được duyệt và đang hiển thị với khách hàng.",
      adminNote: last.reviewNote,
      notices: [],
      stale: false,
    };
  }
  return {
    key: "NONE",
    label: null,
    tone: "neutral",
    description: "Tin đăng của bạn đang hiển thị với khách hàng. Muốn đổi nội dung, giá hay ảnh, hãy soạn một bản sửa rồi gửi duyệt.",
    adminNote: null,
    notices: [],
    stale: false,
  };
}

/** The closed revision a trainer may copy into a new draft ("Soạn lại từ bản bị từ chối"), or null. */
export function copyableRejected(history: ListingHistoryItem[], now = Date.now()): ListingHistoryItem | null {
  const last = history[0];
  if (!last || last.status !== "REJECTED") return null;
  const closed = Date.parse(last.closedAt ?? last.reviewedAt ?? last.createdAt ?? "");
  if (!Number.isFinite(closed)) return null;
  return now - closed <= COPY_FROM_CLOSED_DAYS * 86_400_000 ? last : null;
}

// ── photos ────────────────────────────────────────────────────────────────────────────────────
export function photoLimitMessage(max: number): string {
  return `Tin đăng chỉ có tối đa ${max} ảnh hình thể. Hãy gỡ hoặc xóa bớt một ảnh trước khi thêm ảnh mới.`;
}

/** How many more photos the draft has room for. */
export const photoRoom = (count: number, max: number): number => Math.max(0, max - count);

/** Moves `id` one step up (−1) or down (+1). Out of range or unknown id → the same order. */
export function movePhoto(ids: string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export type AddPhotoResult = { ids: string[]; cover: string | null; outcome: "added" | "duplicate" | "limit" };

/** Appends a photo. One past `max` is refused, never silently dropped; the first photo becomes the cover. */
export function addPhoto(ids: string[], cover: string | null, id: string, max: number): AddPhotoResult {
  if (ids.includes(id)) return { ids, cover, outcome: "duplicate" };
  if (ids.length >= max) return { ids, cover, outcome: "limit" };
  const next = [...ids, id];
  return { ids: next, cover: cover && ids.includes(cover) ? cover : next[0], outcome: "added" };
}

/** Takes a photo out of the draft; if it was the cover the first remaining photo becomes the cover. */
export function removePhoto(ids: string[], cover: string | null, id: string): { ids: string[]; cover: string | null } {
  const next = ids.filter((x) => x !== id);
  const keep = cover && cover !== id && next.includes(cover) ? cover : null;
  return { ids: next, cover: next.length === 0 ? null : (keep ?? next[0]) };
}

export const setCover = (ids: string[], cover: string | null, id: string): string | null => (ids.includes(id) ? id : cover);

/** Client-side check of a picked file before any request (type + 8 MB), in the trainer's words. */
export function photoFileError(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) return "Chỉ nhận ảnh JPEG, PNG hoặc WebP.";
  if (file.size <= 0) return "Tệp ảnh rỗng.";
  if (file.size > MAX_PHOTO_BYTES) return "Ảnh vượt quá 8 MB. Hãy chọn ảnh nhỏ hơn.";
  return null;
}

// ── editable form ← → payload ─────────────────────────────────────────────────────────────────
export interface ProfileForm {
  professionalBio: string;
  mainSpecialties: string[];
  trainingMethodsApproach: string;
  targetClientGroups: string[];
  primaryTrainingGoals: string[];
  /** Chips: the fixed list plus custom entries added through "Khác" (and saved values outside the list). */
  languages: string[];
  websiteUrl: string;
  linkedinUrl: string;
}

export type PackageItem = PtListingPackageDraft & { key: string };

export interface ListingForm {
  profile: ProfileForm;
  packages: PackageItem[];
  photoIds: string[];
  coverPhotoId: string | null;
}

export function formFromPayload(p: PtListingPayload): ListingForm {
  return {
    profile: {
      professionalBio: p.profile.professionalBio ?? "",
      mainSpecialties: p.profile.mainSpecialties,
      trainingMethodsApproach: p.profile.trainingMethodsApproach ?? "",
      targetClientGroups: p.profile.targetClientGroups,
      primaryTrainingGoals: p.profile.primaryTrainingGoals,
      languages: p.profile.languages,
      websiteUrl: p.profile.websiteUrl ?? "",
      linkedinUrl: p.profile.linkedinUrl ?? "",
    },
    packages: p.packages.map((pkg, i) => ({ ...pkg, key: pkg.id ?? `existing-${i}` })),
    photoIds: p.photoIds,
    coverPhotoId: p.coverPhotoId,
  };
}

const unique = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))];
const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Toggles a value in a chip list, keeping the 10-item cap (a refused add returns the same list). */
export function toggleListValue(list: string[], value: string, max = LIST_MAX_ITEMS): string[] {
  if (list.includes(value)) return list.filter((x) => x !== value);
  if (list.length >= max) return list;
  return [...list, value];
}

/** Adds a custom language: trimmed, no duplicates (case-insensitive), within the server's 30-char / 10-item caps. */
export function addCustomLanguage(
  current: string[],
  raw: string,
): { languages: string[]; outcome: "added" | "empty" | "duplicate" | "too_long" | "limit" } {
  const name = raw.trim();
  if (!name) return { languages: current, outcome: "empty" };
  if (name.length > LANGUAGE_ITEM_MAX) return { languages: current, outcome: "too_long" };
  if (current.some((x) => x.toLowerCase() === name.toLowerCase())) return { languages: current, outcome: "duplicate" };
  if (current.length >= LIST_MAX_ITEMS) return { languages: current, outcome: "limit" };
  return { languages: [...current, name], outcome: "added" };
}

/** The body of `PUT .../draft` (payload part). The same normalization the server applies, so it compares clean. */
export function buildDraftPayload(form: ListingForm): PtListingPayload {
  const photoIds = [...new Set(form.photoIds)];
  const cover = photoIds.length === 0 ? null : form.coverPhotoId && photoIds.includes(form.coverPhotoId) ? form.coverPhotoId : photoIds[0];
  return {
    profile: {
      professionalBio: orNull(form.profile.professionalBio),
      mainSpecialties: unique(form.profile.mainSpecialties),
      trainingMethodsApproach: orNull(form.profile.trainingMethodsApproach),
      targetClientGroups: unique(form.profile.targetClientGroups),
      primaryTrainingGoals: unique(form.profile.primaryTrainingGoals),
      languages: unique(form.profile.languages),
      websiteUrl: orNull(form.profile.websiteUrl),
      linkedinUrl: orNull(form.profile.linkedinUrl),
    },
    packages: form.packages.map(({ key: _key, ...pkg }) => ({
      ...(pkg.id ? { id: pkg.id } : {}),
      name: pkg.name.trim(),
      description: orNull(pkg.description ?? ""),
      price: pkg.price,
      sessionCount: pkg.sessionCount,
      sessionMode: pkg.sessionMode,
      sessionDurationMinutes: pkg.sessionDurationMinutes,
      validityDays: pkg.validityDays,
      isActive: pkg.isActive,
      ...(pkg.archive ? { archive: true } : {}),
    })),
    photoIds,
    coverPhotoId: cover,
  };
}

/** A stable string for "did the trainer change anything". */
export const payloadSignature = (payload: PtListingPayload): string => JSON.stringify(buildDraftPayload(formFromPayload(payload)));
export const formSignature = (form: ListingForm): string => JSON.stringify(buildDraftPayload(form));

/** Packages that will still be for sale after approval (counts against the 10-package cap). */
export const livePackages = <T extends { archive?: boolean }>(packages: T[]): T[] => packages.filter((p) => !p.archive);

// ── package editor ────────────────────────────────────────────────────────────────────────────
/** The text-box state of the package editor (everything a string until validated). */
export interface PackageForm {
  name: string;
  description: string;
  sessionCount: string;
  price: string;
  sessionMode: "ONLINE" | "OFFLINE";
  sessionDurationMinutes: string;
  validityDays: string;
}

export const EMPTY_PACKAGE: PackageForm = {
  name: "",
  description: "",
  sessionCount: "",
  price: "",
  sessionMode: "ONLINE",
  sessionDurationMinutes: "60",
  validityDays: "",
};

export function packageFormFrom(p: PtListingPackageDraft): PackageForm {
  return {
    name: p.name,
    description: p.description ?? "",
    sessionCount: p.sessionCount ? String(p.sessionCount) : "",
    price: p.price ? String(Math.trunc(p.price)) : "",
    sessionMode: p.sessionMode,
    sessionDurationMinutes: String(p.sessionDurationMinutes),
    validityDays: p.validityDays != null ? String(p.validityDays) : "",
  };
}

/** Mirror of pt-listing.schemas.ts#ptListingPackageSchema, in the trainer's words. */
export function listingPackageError(f: PackageForm): string | null {
  const name = f.name.trim();
  if (!name) return "Đặt tên cho gói.";
  if (name.length > 80) return "Tên gói tối đa 80 ký tự.";
  if (f.description.trim().length > 1000) return "Mô tả gói tối đa 1000 ký tự.";
  const sessions = Number(f.sessionCount);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 200) return "Số buổi phải là số nguyên từ 1 đến 200.";
  const price = Number(f.price);
  if (!Number.isFinite(price) || price <= 0) return "Nhập giá gói lớn hơn 0.";
  if (price > 1_000_000_000) return "Giá gói tối đa 1.000.000.000 ₫.";
  const minutes = Number(f.sessionDurationMinutes);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) return "Thời lượng mỗi buổi từ 15 đến 240 phút.";
  if (f.validityDays.trim()) {
    const days = Number(f.validityDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return "Hạn dùng từ 1 đến 3650 ngày.";
  }
  return null;
}

/** Applies the editor's form to a package (keeps its id, active flag and archive mark). */
export function applyPackageForm(f: PackageForm, base?: PackageItem, newKey?: string): PackageItem {
  return {
    ...(base?.id ? { id: base.id } : {}),
    key: base?.key ?? newKey ?? `new-${Date.now()}`,
    name: f.name.trim(),
    description: orNull(f.description),
    price: Number(f.price),
    sessionCount: Number(f.sessionCount),
    sessionMode: f.sessionMode,
    sessionDurationMinutes: Number(f.sessionDurationMinutes),
    validityDays: f.validityDays.trim() ? Number(f.validityDays) : null,
    isActive: base ? base.isActive : true,
    ...(base?.archive ? { archive: true } : {}),
  };
}

/** Existing packages are dropped by mark (so it can be undone and the server archives it); new ones just go. */
export function archivePackageItem(packages: PackageItem[], key: string): PackageItem[] {
  return packages.flatMap((p) => {
    if (p.key !== key) return [p];
    return p.id ? [{ ...p, archive: true }] : [];
  });
}
export const restorePackageItem = (packages: PackageItem[], key: string): PackageItem[] =>
  packages.map((p) => {
    if (p.key !== key) return p;
    const { archive: _archive, ...rest } = p;
    return rest;
  });
export const togglePackageActive = (packages: PackageItem[], key: string): PackageItem[] =>
  packages.map((p) => (p.key === key ? { ...p, isActive: !p.isActive } : p));

// ── whole-form validation (mirror of the server's payload schema) ─────────────────────────────
const URL_RE = /^https?:\/\/[^\s]+$/i;

export function validateListingForm(form: ListingForm, limits: PtListingLimits = DEFAULT_LIMITS): string | null {
  const p = form.profile;
  if (p.professionalBio.trim().length > BIO_MAX) return `Phần giới thiệu tối đa ${BIO_MAX} ký tự.`;
  if (p.trainingMethodsApproach.trim().length > METHODS_MAX) return `Phương pháp huấn luyện tối đa ${METHODS_MAX} ký tự.`;
  for (const [label, list] of [
    ["Chuyên môn", unique(p.mainSpecialties)],
    ["Nhóm học viên", unique(p.targetClientGroups)],
    ["Mục tiêu huấn luyện", unique(p.primaryTrainingGoals)],
  ] as const) {
    if (list.length > LIST_MAX_ITEMS) return `${label}: chọn tối đa ${LIST_MAX_ITEMS} mục.`;
    if (list.some((x) => x.length > LIST_ITEM_MAX)) return `${label}: mỗi mục tối đa ${LIST_ITEM_MAX} ký tự.`;
  }
  const langs = unique(p.languages);
  if (langs.length > LIST_MAX_ITEMS) return `Ngôn ngữ: tối đa ${LIST_MAX_ITEMS} ngôn ngữ.`;
  if (langs.some((x) => x.length > LANGUAGE_ITEM_MAX)) return `Ngôn ngữ: mỗi mục tối đa ${LANGUAGE_ITEM_MAX} ký tự.`;
  for (const [label, url] of [
    ["Website", p.websiteUrl],
    ["LinkedIn", p.linkedinUrl],
  ] as const) {
    const u = url.trim();
    if (!u) continue;
    if (u.length > URL_MAX) return `${label}: đường dẫn tối đa ${URL_MAX} ký tự.`;
    if (!URL_RE.test(u)) return `${label}: đường dẫn phải bắt đầu bằng http:// hoặc https://`;
  }
  if (livePackages(form.packages).length > limits.maxPackages) {
    return `Mỗi huấn luyện viên có tối đa ${limits.maxPackages} gói đang bán.`;
  }
  for (const pkg of form.packages) {
    if (pkg.archive) continue;
    const err = listingPackageError(packageFormFrom(pkg));
    if (err) return `Gói "${pkg.name || "chưa đặt tên"}": ${err}`;
  }
  if (form.photoIds.length > limits.maxPhotos) return photoLimitMessage(limits.maxPhotos);
  return null;
}

// ── keeping the editor in step with the server (B7: never overwrite someone else's draft silently) ─
export interface DraftSyncState {
  /** Revision id the form was built from. */
  formRevisionId: string | null;
  /** Server draftVersion the form/baseline was last synced to. */
  lastSeenVersion: number | null;
  /** The version the next save will send as expectedDraftVersion. */
  version: number;
  dirty: boolean;
}

export type DraftSyncAction = "clear" | "reset" | "none" | "own" | "conflict";

/**
 *  clear    — no open DRAFT any more: drop the form.
 *  reset    — new revision, or the server moved and the trainer has no unsaved edits: rebuild the form.
 *  none     — nothing changed.
 *  own      — the server moved to exactly the version this tab expects (its own save / photo delete): only refresh the baseline.
 *  conflict — the server moved to a version this tab did not cause while there are unsaved edits: ask the trainer.
 */
export function decideDraftSync(s: DraftSyncState, rev: { id: string; draftVersion: number } | null): DraftSyncAction {
  if (!rev) return "clear";
  if (s.formRevisionId !== rev.id) return "reset";
  if (rev.draftVersion === s.lastSeenVersion) return "none";
  if (rev.draftVersion === s.version) return "own";
  return s.dirty ? "conflict" : "reset";
}

/** Deleting a photo that is in the SAVED draft makes the server bump draftVersion once. */
export function versionAfterPhotoDelete(version: number, savedPhotoIds: string[], photoId: string): number {
  return savedPhotoIds.includes(photoId) ? version + 1 : version;
}

// ── caches (user-scoped: a previous account's listing must never be served to the next one) ───
export const ptListingKey = (uid: string) => ["pt-listing", uid] as const;
export const ptListingPreviewKey = (uid: string) => ["pt-listing-preview", uid] as const;
/** Preview photo links last 15 minutes (server) — keep the cached copy 10 so a link is never served near expiry. */
export const PREVIEW_STALE_MS = 10 * 60 * 1000;

/**
 * Every query that can show this trainer's listing: the page's own, plus what clients and the PT's own
 * profile/packages views read. Public keys end in the trainer id (or are list prefixes) so one prefix reaches all.
 */
export function ptListingInvalidationKeys(uid: string): (readonly unknown[])[] {
  return [
    ptListingKey(uid),
    ptListingPreviewKey(uid),
    ["pts-list"],
    ["pt-detail", uid],
    ["pt-packages", uid],
    ["pt-service-packages"],
    ["pt-public-profile", uid],
  ];
}

// ── preview (GET /profile/me/listing/preview → ListingPreviewDto) ────────────────────────────
export function normalizePreview(raw: any): PtListingPreview | null {
  if (!raw || raw.isPreview !== true) return null;
  const app = raw.ptApplication ?? {};
  const price = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  return {
    revisionStatus: String(raw.revisionStatus ?? ""),
    name: [raw.firstName, raw.lastName].filter(Boolean).join(" ").trim() || "Huấn luyện viên",
    specialties: strList(raw.specialties),
    profile: normalizeProfile(app),
    fromPricePerSession: price(raw.fromPricePerSession),
    fromPackagePrice: price(raw.fromPackagePrice),
    packages: (Array.isArray(raw.servicePackages) ? raw.servicePackages : []).map((p: any) => ({
      ...normalizePackageDraft(p),
      isNew: p?.isNew === true,
    })),
    photos: (Array.isArray(raw.physiquePhotos) ? raw.physiquePhotos : [])
      .filter((p: any) => p && typeof p.id === "string" && typeof p.url === "string")
      .map((p: any) => ({ id: p.id, url: p.url, isCover: p.isCover === true })),
    coverPhotoUrl: typeof raw.coverPhotoUrl === "string" ? raw.coverPhotoUrl : null,
    photoUrlsExpireAt: typeof raw.photoUrlsExpireAt === "string" ? raw.photoUrlsExpireAt : null,
  };
}
