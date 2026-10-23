// Request-body builders for Tier B. Pure: world entity (+ ids resolved from earlier responses) -> JSON body.
// __tests__/payloads.test.mjs parses every body with the service's REAL zod schema (pt-listing.schemas.ts, gym-listing.schemas.ts,
// application.schemas.ts, gym.schemas.ts, plan.schemas.ts, amenity-selection.schemas.ts), so a drift in a schema fails a test.
import { WEEKDAY_ENUM } from "../world/constants.mjs";

/** PT application draft (POST /pt-applications/me/draft). Document URLs come from the presign/confirm responses. */
export function ptDraftBody(pt, docs = {}) {
  const a = pt.app;
  return {
    phoneNumber: a.phoneNumber,
    nationalIdNumber: a.nationalIdNumber,
    currentAddress: a.currentAddress,
    ...(docs.idCardFrontUrl ? { idCardFrontUrl: docs.idCardFrontUrl, idCardBackUrl: docs.idCardBackUrl, portraitPhotoUrl: docs.portraitPhotoUrl } : {}),
    yearsOfExperience: a.yearsOfExperience,
    educationBackground: a.educationBackground,
    previousWorkExperience: a.previousWorkExperience,
    professionalBio: a.professionalBio,
    mainSpecialties: a.mainSpecialties,
    targetClientGroups: a.targetClientGroups,
    primaryTrainingGoals: a.primaryTrainingGoals,
    trainingMethodsApproach: a.trainingMethodsApproach,
    linkedinUrl: a.linkedinUrl,
    websiteUrl: a.websiteUrl,
    serviceMode: a.serviceMode,
    operatingAreas: a.operatingAreas,
    onlinePricePerSession: a.onlinePricePerSession,
    offlinePricePerSession: a.offlinePricePerSession,
    onlinePackagePrice: a.onlinePackagePrice,
    offlinePackagePrice: a.offlinePackagePrice,
    sessionsPerPackage: a.sessionsPerPackage,
    sessionDurationMinutes: a.sessionDurationMinutes,
    availableDays: a.availableDays,
    availableFrom: a.availableFrom,
    availableUntil: a.availableUntil,
    availabilityBlocks: a.availabilityBlocks,
    gymAffiliation: a.gymAffiliation,
    residenceProvinceCode: pt.area.provinceCode,
    residenceWardCode: pt.area.wardCode,
    residenceAddressLine: pt.loc.addressLine,
    applicationTrainingLocations: a.trainingLocations.map((l) => ({ ...l, note: undefined })),
    certificates: a.certificates,
  };
}

export const ptReviewBody = {
  "UNDER_REVIEW": () => ({}),
  "NEEDS_MORE_INFO": (pt) => ({ adminNote: pt.app.adminNote }),
  "REJECTED": (pt) => ({ rejectionReason: pt.app.rejectionReason }),
  "APPROVED": () => ({}),
};

// ---- PT listing -------------------------------------------------------------------------------------------------------
export function ptPackagePayload(p, id) {
  return {
    ...(id ? { id } : {}),
    name: p.name,
    description: p.description ?? null,
    price: p.price,
    sessionCount: p.sessionCount,
    sessionMode: p.sessionMode,
    sessionDurationMinutes: p.sessionDurationMinutes,
    validityDays: p.validityDays ?? null,
    isActive: p.isActive,
  };
}

/** The COMPLETE desired payload (a revision is a full replacement). */
export function ptListingPayload(pt, { photoIds = [], coverPhotoId = null, packages = pt.packages.map((p) => ptPackagePayload(p)), profileOverride = {} } = {}) {
  const a = pt.app;
  return {
    profile: {
      professionalBio: a.professionalBio ?? null,
      mainSpecialties: a.mainSpecialties,
      trainingMethodsApproach: a.trainingMethodsApproach ?? null,
      targetClientGroups: a.targetClientGroups,
      primaryTrainingGoals: a.primaryTrainingGoals,
      languages: a.languages,
      websiteUrl: a.websiteUrl ?? null,
      linkedinUrl: a.linkedinUrl ?? null,
      ...profileOverride,
    },
    packages,
    photoIds,
    coverPhotoId,
  };
}
export const ptSaveDraftBody = (expectedDraftVersion, payload, ownerNote) => ({ expectedDraftVersion, payload, ...(ownerNote ? { ownerNote } : {}) });
export const submitBody = (expectedDraftVersion, ownerNote) => ({ expectedDraftVersion, ...(ownerNote ? { ownerNote } : {}) });

/** Admin decisions. */
export const approveBody = (note) => (note ? { note } : {});
export const noteBody = (note) => ({ note });
export const directEditBody = ({ reason, expectedListingVersion, ...rest }) => ({ ...rest, reason, expectedListingVersion });

// ---- Gym listing ---------------------------------------------------------------------------------------------------------
export function gymListingPayload({ description, amenityIds = [], proposalIds = [], photoIds = [], coverPhotoId = null }) {
  return { description: description ?? null, amenityIds, proposalIds, photoIds, coverPhotoId };
}

// ---- Gym application / branch ---------------------------------------------------------------------------------------------
export const representativeBody = (owner) => ({ name: owner.partner.representative.name, phone: owner.partner.representative.phone, role: owner.partner.representative.role });
export const businessScaleBody = (owner) => ({ scale: owner.partner.scale });
export const applicationBrandBody = (owner) => ({ name: owner.brand.name, description: owner.brand.description });
export const applicationBranchBody = (b) => ({ name: b.name, phone: b.phone, address: b.address, description: b.description, ...(b.locationNote ? { locationNote: b.locationNote } : {}), city: b.area.provinceName });
export const applicationLocationBody = (b) => ({ provinceCode: b.area.provinceCode, wardCode: b.area.wardCode, latitude: b.latitude, longitude: b.longitude });
export const legalBody = (owner) => ({ legalName: owner.partner.legal.legalName, taxCode: owner.partner.legal.taxCode, businessLicenseNo: owner.partner.legal.businessLicenseNo });
export const socialBody = (owner) => Object.fromEntries(Object.entries(owner.partner.social).filter(([, v]) => v));
export const submitApplicationBody = () => ({ acceptTerms: true });
export const requestChangesBody = (changes) => ({ issues: changes.issues ?? [], documents: changes.documents ?? [] });
export const rejectApplicationBody = (reason) => ({ reason, adminNote: "Đã liên hệ ứng viên qua email." });
export const payoutBody = (owner) => ({ bankName: owner.partner.bank.bankName, accountNumber: owner.partner.bank.accountNumber, accountHolder: owner.partner.bank.accountHolder });

export const wizardDraftBody = (b, amenityIds, step) => ({
  name: b.name, description: b.description, address: b.address, city: b.area.provinceName, phone: b.phone, email: b.email,
  provinceCode: b.area.provinceCode, wardCode: b.area.wardCode, latitude: b.latitude, longitude: b.longitude,
  ...(b.locationNote ? { locationNote: b.locationNote } : {}), amenityIds, wizardStep: step,
});
export const quickCreateBody = (b, amenityIds) => ({
  name: b.name, description: b.description, address: b.address, city: b.area.provinceName, phone: b.phone, email: b.email,
  provinceCode: b.area.provinceCode, wardCode: b.area.wardCode, latitude: b.latitude, longitude: b.longitude,
  ...(b.locationNote ? { locationNote: b.locationNote } : {}), ...(amenityIds.length ? { amenityIds } : {}),
});
export const hoursBody = (b) => ({ days: b.hours });
export const operationalBody = (b) => ({ operationalStatus: b.op, reason: b.opReason });
export const planBody = (p) => ({ name: p.name, description: p.description, price: p.price, durationDays: p.durationDays, ...(p.visitLimit ? { visitLimit: p.visitLimit } : {}) });
export const planPatchBody = (status) => ({ status });
export const adminGymStatusBody = (status) => ({ status });
export const partnerSuspendBody = (reason) => ({ reason });

// ---- amenities --------------------------------------------------------------------------------------------------------------
export const proposalBody = (gymId, p) => ({ gymId, name: p.name, suggestedCategory: p.category, ...(p.note ? { note: p.note } : {}) });
export const inlineProposal = (p) => ({ name: p.name, suggestedCategory: p.category, ...(p.note ? { note: p.note } : {}) });
export const catalogueCreateBody = (a) => ({ name: a.name, category: a.category, iconKey: a.iconKey, sortOrder: a.sortOrder });
export const proposalApproveBody = (ids, extra = {}) => ({ proposalIds: ids, ...extra });
export const proposalRejectBody = (ids, reason) => ({ proposalIds: ids, reason });
export const proposalMergeBody = (ids, targetAmenityId) => ({ proposalIds: ids, targetAmenityId });
export const catalogueToggleBody = (status, reason) => ({ status, reason });

// ---- money ---------------------------------------------------------------------------------------------------------------------
export const contractRequestBody = (ptUserId, pkg, gymId) => ({ ptUserId, packageId: pkg.id, expectedPackageVersion: pkg.version, clientMessage: "Em muốn bắt đầu tập sớm, mong anh/chị sắp xếp giúp em.", ...(gymId ? { gymId } : {}), acknowledgedLowAvailability: true });
export const payBody = () => ({ provider: "VNPAY" });
export const membershipBody = (planId) => ({ planId, provider: "VNPAY", acknowledgedMultiGymWarning: true });
export const reviewBody = (rating, comment) => ({ rating, comment });
export const suspendPtBody = (category, reason, publicReason) => ({ category, reason, publicReason });
export const restrictContractBody = (category, reason, publicReason) => ({ category, reason, publicReason });
export { WEEKDAY_ENUM };
