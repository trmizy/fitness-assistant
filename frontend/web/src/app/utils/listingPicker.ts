/**
 * Listing Management D1 - "Chọn huấn luyện viên / chi nhánh để sửa": which PTs / branches an admin may open
 * "Sửa trực tiếp" for even when they have no revision, and how the search box filters them.
 *
 * Sources are the EXISTING admin lists (the current published listing itself comes from GET /admin/listings/{pts|gyms}/:id):
 *   PT   GET /pt-applications/admin?status=APPROVED  (rows carry `userProfile`: userId, name, isPT, listingVersion)
 *   Gym  GET /admin/gyms                              (rows carry status, operationalStatus, brand)
 * Pure: runs under `npx tsx --test`.
 */

export interface PickerTarget {
  /** PT: user id. Gym: branch id. */
  id: string;
  title: string;
  subtitle: string | null;
  /** Lower-cased, accent-free text the search runs on. */
  haystack: string;
}

/** "Phòng tập Đà Nẵng" -> "phong tap da nang": accent- and case-insensitive, spaces collapsed. */
export function foldText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined) =>
  [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();

/**
 * PT is listing-eligible when the application is APPROVED and the profile is a PT.
 * (A suspended or restricted PT stays eligible: moderating a hidden listing is exactly an admin's job; the server
 * decides what is editable and answers with its own error.)
 */
export function eligiblePtTargets(applications: unknown): PickerTarget[] {
  if (!Array.isArray(applications)) return [];
  const out: PickerTarget[] = [];
  for (const app of applications as any[]) {
    const profile = app?.userProfile ?? app?.user;
    const userId = profile?.userId ?? profile?.id;
    if (app?.status !== "APPROVED" || profile?.isPT !== true || typeof userId !== "string" || !userId) continue;
    const title = fullName(profile) || "Huấn luyện viên";
    const subtitle = typeof profile?.email === "string" && profile.email ? profile.email : null;
    out.push({ id: userId, title, subtitle, haystack: foldText(`${title} ${subtitle ?? ""}`) });
  }
  return dedupe(out);
}

/** Branch is listing-eligible when APPROVED or SUSPENDED and not permanently closed. */
export function eligibleGymTargets(gyms: unknown): PickerTarget[] {
  if (!Array.isArray(gyms)) return [];
  const out: PickerTarget[] = [];
  for (const g of gyms as any[]) {
    if (!g || typeof g.id !== "string") continue;
    if (g.status !== "APPROVED" && g.status !== "SUSPENDED") continue;
    if (g.operationalStatus === "PERMANENTLY_CLOSED") continue;
    const title = g.approvedName || g.name || "Chi nhánh";
    const brand = g.brand?.approvedName || g.brand?.name || null;
    const place = g.approvedAddress || g.address || null;
    const subtitle = [brand, place].filter(Boolean).join(" · ") || null;
    out.push({ id: g.id, title, subtitle, haystack: foldText(`${title} ${subtitle ?? ""}`) });
  }
  return dedupe(out);
}

function dedupe(list: PickerTarget[]): PickerTarget[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** Every word typed must appear (accent/case-insensitive); empty search = nothing is shown (the list is long). */
export function filterTargets(targets: PickerTarget[], query: string, limit = 8): PickerTarget[] {
  const words = foldText(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  return targets
    .filter((t) => words.every((w) => t.haystack.includes(w)))
    .sort((a, b) => a.title.localeCompare(b.title, "vi"))
    .slice(0, limit);
}
