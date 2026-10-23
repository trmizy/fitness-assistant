/**
 * Pure comparison of two listing payloads: what the admin sees as the "diff" of a revision, what the audit row
 * stores, and what decides NO_CHANGES at submit. No I/O.
 */
import { PROFILE_FIELDS, PACKAGE_COMMERCIAL_FIELDS, type PtListingPackage, type PtListingPayload } from "./pt-listing.schemas";

export interface FieldChange {
  /** e.g. "profile.professionalBio", "packages[<id>].price", "packages[+]", "photoIds", "coverPhotoId" */
  path: string;
  before: unknown;
  after: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Value of one commercial field in comparable form (price as a number, empty description as null). */
function pkgValue(p: Partial<PtListingPackage>, field: (typeof PACKAGE_COMMERCIAL_FIELDS)[number]): unknown {
  const v = (p as any)[field];
  if (field === "price") return v === undefined ? undefined : Number(v);
  if (field === "description") return v === undefined || v === "" ? null : v;
  if (field === "name") return typeof v === "string" ? v.trim() : v;
  return v === undefined ? null : v;
}

/** Packages that survive a payload (not flagged archive). */
export function livePackages(payload: PtListingPayload): PtListingPackage[] {
  return payload.packages.filter((p) => !p.archive);
}

export function diffPayloads(before: PtListingPayload, after: PtListingPayload): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const f of PROFILE_FIELDS) {
    if (!same(before.profile[f], after.profile[f])) {
      changes.push({ path: `profile.${f}`, before: before.profile[f] ?? null, after: after.profile[f] ?? null });
    }
  }

  const beforeById = new Map(before.packages.filter((p) => p.id).map((p) => [p.id as string, p]));
  const afterLive = livePackages(after);
  const afterIds = new Set(afterLive.map((p) => p.id).filter(Boolean) as string[]);

  for (const p of afterLive) {
    if (!p.id || !beforeById.has(p.id)) {
      changes.push({ path: "packages[+]", before: null, after: p });
      continue;
    }
    const old = beforeById.get(p.id)!;
    for (const field of PACKAGE_COMMERCIAL_FIELDS) {
      const b = pkgValue(old, field);
      const a = pkgValue(p, field);
      if (!same(b, a)) changes.push({ path: `packages[${p.id}].${field}`, before: b, after: a });
    }
  }
  for (const [id, old] of beforeById) {
    if (!afterIds.has(id)) changes.push({ path: `packages[${id}]`, before: old, after: null });
  }

  if (!same(before.photoIds, after.photoIds)) changes.push({ path: "photoIds", before: before.photoIds, after: after.photoIds });
  if (!same(before.coverPhotoId, after.coverPhotoId)) {
    changes.push({ path: "coverPhotoId", before: before.coverPhotoId, after: after.coverPhotoId });
  }
  return changes;
}
