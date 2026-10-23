/**
 * Listing Management (Phase D1) — turns the server's `changes` list (pt-listing-diff.ts / gym-listing-diff.ts,
 * returned by GET /admin/listings/{pts|gyms}/revisions/:rid) into display rows for <ListingDiffView/>.
 *
 * The SERVER decides what changed (it compares the revision with what is public right now); this file only
 * groups and words it. Pure: runs under `npx tsx --test`.
 */
import type { ListingFieldChange } from "../types";

// ── labels ───────────────────────────────────────────────────────────────────────────────────
export const PROFILE_FIELD_LABEL: Record<string, string> = {
  professionalBio: "Giới thiệu bản thân",
  mainSpecialties: "Chuyên môn",
  trainingMethodsApproach: "Phương pháp huấn luyện",
  targetClientGroups: "Nhóm học viên",
  primaryTrainingGoals: "Mục tiêu huấn luyện",
  languages: "Ngôn ngữ",
  websiteUrl: "Website",
  linkedinUrl: "LinkedIn",
};

export const PACKAGE_FIELD_LABEL: Record<string, string> = {
  name: "Tên gói",
  description: "Mô tả",
  price: "Giá",
  sessionCount: "Số buổi",
  sessionMode: "Hình thức",
  sessionDurationMinutes: "Thời lượng mỗi buổi",
  validityDays: "Hạn dùng",
  isActive: "Trạng thái bán",
};

const LIST_FIELDS = new Set(["mainSpecialties", "targetClientGroups", "primaryTrainingGoals", "languages"]);

// ── value formatting ─────────────────────────────────────────────────────────────────────────
const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;

/** One package field as the admin reads it ("2.000.000 ₫", "Trực tiếp", "Đang bán"). */
export function formatPackageValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return field === "validityDays" ? "Không giới hạn" : "—";
  }
  switch (field) {
    case "price":
      return vnd(Number(value));
    case "sessionMode":
      return value === "ONLINE" ? "Online" : value === "OFFLINE" ? "Trực tiếp" : String(value);
    case "sessionDurationMinutes":
      return `${value} phút`;
    case "validityDays":
      return `${value} ngày`;
    case "sessionCount":
      return `${value} buổi`;
    case "isActive":
      return value ? "Đang bán" : "Tạm ngưng";
    default:
      return String(value);
  }
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ── rows ─────────────────────────────────────────────────────────────────────────────────────
export type DiffRow =
  | { kind: "text"; key: string; label: string; before: string | null; after: string | null }
  | { kind: "list"; key: string; label: string; added: string[]; removed: string[] }
  | { kind: "package"; key: string; change: "added" | "removed" | "edited"; name: string; fields: Array<{ label: string; before: string | null; after: string | null }> }
  | { kind: "photos"; key: string; before: string[]; after: string[]; added: string[]; removed: string[]; reordered: boolean }
  | { kind: "cover"; key: string; before: string | null; after: string | null }
  | { kind: "amenities"; key: string; label: string; added: string[]; removed: string[] };

/** photoIds change → which photos came/went, and whether the order of the ones that stayed changed. */
export function photoDiff(before: string[], after: string[]) {
  const b = new Set(before);
  const a = new Set(after);
  const added = after.filter((x) => !b.has(x));
  const removed = before.filter((x) => !a.has(x));
  const keptBefore = before.filter((x) => a.has(x));
  const keptAfter = after.filter((x) => b.has(x));
  const reordered = keptBefore.some((x, i) => x !== keptAfter[i]);
  return { added, removed, reordered };
}

function listDiff(before: string[], after: string[]) {
  return { added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) };
}

const pkgSnapshotName = (p: any): string => (p && typeof p.name === "string" && p.name ? p.name : "Gói dịch vụ");

/**
 * PT: groups `profile.*`, `packages[...]`, `photoIds`, `coverPhotoId` into rows.
 * `packageNameOf(id)` names a package that only shows up as `packages[<id>].<field>` rows.
 */
export function buildPtDiffRows(changes: ListingFieldChange[], opts: { packageNameOf?: (id: string) => string | null } = {}): DiffRow[] {
  const rows: DiffRow[] = [];
  const edited = new Map<string, DiffRow & { kind: "package" }>();

  for (const c of changes) {
    if (c.path.startsWith("profile.")) {
      const field = c.path.slice("profile.".length);
      const label = PROFILE_FIELD_LABEL[field] ?? field;
      if (LIST_FIELDS.has(field)) {
        rows.push({ kind: "list", key: c.path, label, ...listDiff(asStrings(c.before), asStrings(c.after)) });
      } else {
        rows.push({ kind: "text", key: c.path, label, before: (c.before as string | null) ?? null, after: (c.after as string | null) ?? null });
      }
      continue;
    }
    if (c.path === "packages[+]") {
      const p: any = c.after;
      rows.push({
        kind: "package",
        key: `${c.path}:${rows.length}`,
        change: "added",
        name: pkgSnapshotName(p),
        fields: ["price", "sessionCount", "sessionMode", "sessionDurationMinutes", "validityDays"].map((f) => ({
          label: PACKAGE_FIELD_LABEL[f],
          before: null,
          after: formatPackageValue(f, p?.[f]),
        })),
      });
      continue;
    }
    const removedMatch = /^packages\[([^\]]+)\]$/.exec(c.path);
    if (removedMatch) {
      const p: any = c.before;
      rows.push({
        kind: "package",
        key: c.path,
        change: "removed",
        name: pkgSnapshotName(p),
        fields: [{ label: PACKAGE_FIELD_LABEL.price, before: formatPackageValue("price", p?.price), after: null }],
      });
      continue;
    }
    const fieldMatch = /^packages\[([^\]]+)\]\.(.+)$/.exec(c.path);
    if (fieldMatch) {
      const [, id, field] = fieldMatch;
      let row = edited.get(id);
      if (!row) {
        row = { kind: "package", key: `packages[${id}]`, change: "edited", name: opts.packageNameOf?.(id) ?? "Gói dịch vụ", fields: [] };
        edited.set(id, row);
        rows.push(row);
      }
      row.fields.push({
        label: PACKAGE_FIELD_LABEL[field] ?? field,
        before: formatPackageValue(field, c.before),
        after: formatPackageValue(field, c.after),
      });
      continue;
    }
    if (c.path === "photoIds") {
      const before = asStrings(c.before);
      const after = asStrings(c.after);
      rows.push({ kind: "photos", key: c.path, before, after, ...photoDiff(before, after) });
      continue;
    }
    if (c.path === "coverPhotoId") {
      rows.push({ kind: "cover", key: c.path, before: (c.before as string | null) ?? null, after: (c.after as string | null) ?? null });
    }
  }
  return rows;
}

/**
 * Gym: `description`, `amenityIds`, `proposalIds`, `photoIds`, `coverPhotoId`. Amenity / proposal ids are shown by
 * name through the lookups (an unknown id falls back to a neutral word, never the raw id).
 */
export function buildGymDiffRows(
  changes: ListingFieldChange[],
  opts: { amenityName?: (id: string) => string | null; proposalName?: (id: string) => string | null } = {},
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const c of changes) {
    if (c.path === "description") {
      rows.push({ kind: "text", key: c.path, label: "Giới thiệu phòng gym", before: (c.before as string | null) ?? null, after: (c.after as string | null) ?? null });
    } else if (c.path === "amenityIds" || c.path === "proposalIds") {
      const nameOf = c.path === "amenityIds" ? opts.amenityName : opts.proposalName;
      const fallback = c.path === "amenityIds" ? "Tiện ích" : "Tiện ích đề xuất";
      const added = c.added ?? listDiff(asStrings(c.before), asStrings(c.after)).added;
      const removed = c.removed ?? listDiff(asStrings(c.before), asStrings(c.after)).removed;
      rows.push({
        kind: "amenities",
        key: c.path,
        label: c.path === "amenityIds" ? "Tiện ích" : "Tiện ích tùy chỉnh chờ duyệt",
        added: added.map((id) => nameOf?.(id) ?? fallback),
        removed: removed.map((id) => nameOf?.(id) ?? fallback),
      });
    } else if (c.path === "photoIds") {
      const before = asStrings(c.before);
      const after = asStrings(c.after);
      rows.push({ kind: "photos", key: c.path, before, after, ...photoDiff(before, after) });
    } else if (c.path === "coverPhotoId") {
      rows.push({ kind: "cover", key: c.path, before: (c.before as string | null) ?? null, after: (c.after as string | null) ?? null });
    }
  }
  return rows;
}
