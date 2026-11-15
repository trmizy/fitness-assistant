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

/** Steps whose content only exists once the first branch does: with no branch yet the server lists no LOCATION / AMENITIES item, which is NOT "done". */
const NEEDS_BRANCH: ReadonlySet<StepId> = new Set<StepId>(["location", "amenities"]);

export const stepIsDone = (step: WizardStep, missing: readonly Pick<MissingItem, "section">[], hasBranch = true): boolean =>
  (hasBranch || !NEEDS_BRANCH.has(step.id)) && !missing.some((m) => step.sections.includes(m.section));

/**
 * N14G-09: the progress bar used to read 33% on an empty application - "Mạng xã hội" (optional, no section the server can list) and the two
 * branch-dependent steps (Vị trí, Tiện ích: nothing is listed until a branch exists) counted as done. Now only steps that can really be
 * missing count, and a branch-dependent step is done only once the branch exists. The review step is never counted.
 */
export function applicationProgress(missing: readonly Pick<MissingItem, "section">[], hasBranch: boolean): { done: number; total: number; percent: number } {
  const counted = STEPS.filter((s) => s.id !== "review" && s.sections.length > 0);
  const done = counted.filter((s) => stepIsDone(s, missing, hasBranch)).length;
  return { done, total: counted.length, percent: counted.length === 0 ? 0 : Math.round((done / counted.length) * 100) };
}

/** The first step (other than the review) that still has something missing; the review when nothing is. */
export function firstIncompleteIndex(missing: readonly Pick<MissingItem, "section">[]): number {
  const idx = STEPS.findIndex((s) => s.id !== "review" && !stepIsDone(s, missing));
  return idx === -1 ? STEPS.length - 1 : idx;
}

export const stepIndexOf = (id: string): number => STEPS.findIndex((s) => s.id === id);
