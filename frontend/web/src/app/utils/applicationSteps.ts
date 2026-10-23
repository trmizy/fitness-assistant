/**
 * Listing Management (Phase D2) — the partner application wizard's steps, as data.
 *
 * Ten steps (plan §4): Người đại diện → Thương hiệu → Mạng xã hội → Quy mô → Chi nhánh → Vị trí → **Tiện ích** → Ảnh →
 * Xác minh → Xem lại. The server's `missing[]` names a section per item; `AMENITIES` sits between LOCATION and PHOTOS and is
 * only listed for a client that sends `X-Gymini-Listing-Flow: 2` (this one does), so a resume lands on the amenity step.
 *
 * Pure (types only from the service module): runs under `npx tsx --test`.
 */
import type { MissingItem, ReviewCategory } from "../services/partnerApplication";

export type StepId = "representative" | "brand" | "social" | "scale" | "branch" | "location" | "amenities" | "photos" | "legal" | "review";

export interface WizardStep {
  id: StepId;
  title: string;
  sections: MissingItem["section"][];
}

export const STEPS: readonly WizardStep[] = [
  { id: "representative", title: "Người đại diện", sections: ["REPRESENTATIVE"] },
  { id: "brand", title: "Thương hiệu", sections: ["BRAND"] },
  // Không bắt buộc, không có mục "còn thiếu" nào — bỏ trống vẫn nộp được.
  { id: "social", title: "Mạng xã hội", sections: [] },
  { id: "scale", title: "Quy mô", sections: ["SCALE"] },
  { id: "branch", title: "Chi nhánh đầu tiên", sections: ["BRANCH"] },
  { id: "location", title: "Vị trí", sections: ["LOCATION"] },
  { id: "amenities", title: "Tiện ích", sections: ["AMENITIES"] },
  { id: "photos", title: "Ảnh cơ sở", sections: ["PHOTOS"] },
  { id: "legal", title: "Xác minh doanh nghiệp", sections: ["LEGAL"] },
  { id: "review", title: "Xem lại & gửi", sections: ["TERMS"] },
];

/** Which step fixes a "still missing" item. */
export const SECTION_TO_STEP: Record<MissingItem["section"], StepId> = {
  REPRESENTATIVE: "representative",
  BRAND: "brand",
  SCALE: "scale",
  BRANCH: "branch",
  LOCATION: "location",
  AMENITIES: "amenities",
  PHOTOS: "photos",
  LEGAL: "legal",
  TERMS: "review",
};

/** Which step an admin's change request (by category) points at. */
export const CATEGORY_STEP: Record<ReviewCategory, StepId> = {
  REPRESENTATIVE: "representative",
  BRAND: "brand",
  BRANCH: "branch",
  LOCATION: "location",
  AMENITIES: "amenities",
  PHOTOS: "photos",
  LEGAL: "legal",
  OTHER: "review",
};

export const stepIsDone = (step: WizardStep, missing: readonly Pick<MissingItem, "section">[]): boolean =>
  !missing.some((m) => step.sections.includes(m.section));

/** The first step (other than the review) that still has something missing; the review when nothing is. */
export function firstIncompleteIndex(missing: readonly Pick<MissingItem, "section">[]): number {
  const idx = STEPS.findIndex((s) => s.id !== "review" && !stepIsDone(s, missing));
  return idx === -1 ? STEPS.length - 1 : idx;
}

export const stepIndexOf = (id: string): number => STEPS.findIndex((s) => s.id === id);
