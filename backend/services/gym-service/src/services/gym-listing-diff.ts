/**
 * Pure comparison of two branch-listing payloads: what the admin sees as the "diff" of a revision, what the audit row
 * stores, and what decides NO_CHANGES at submit. No I/O.
 */
import type { GymListingPayload } from './gym-listing.schemas';

export interface FieldChange {
  /** "description" | "amenityIds" | "proposalIds" | "photoIds" | "coverPhotoId" */
  path: string;
  before: unknown;
  after: unknown;
  /** For list fields: ids that appear / disappear (order-insensitive), so a UI can show "+2 / -1" without diffing. */
  added?: string[];
  removed?: string[];
}

const norm = (v: string | null | undefined) => (v === undefined || v === null || v === '' ? null : v);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

function setChange(path: string, before: readonly string[], after: readonly string[]): FieldChange | null {
  if (sameSet(before, after)) return null;
  const b = new Set(before);
  const a = new Set(after);
  return { path, before: [...before], after: [...after], added: after.filter((x) => !b.has(x)), removed: before.filter((x) => !a.has(x)) };
}

export function diffPayloads(before: GymListingPayload, after: GymListingPayload): FieldChange[] {
  const changes: FieldChange[] = [];
  if (norm(before.description) !== norm(after.description)) {
    changes.push({ path: 'description', before: norm(before.description), after: norm(after.description) });
  }
  const amenities = setChange('amenityIds', before.amenityIds, after.amenityIds);
  if (amenities) changes.push(amenities);
  const proposals = setChange('proposalIds', before.proposalIds, after.proposalIds);
  if (proposals) changes.push(proposals);

  // Photos: the ORDER is part of the listing, so a reorder is a change.
  if (JSON.stringify(before.photoIds) !== JSON.stringify(after.photoIds)) {
    const b = new Set(before.photoIds);
    const a = new Set(after.photoIds);
    changes.push({
      path: 'photoIds',
      before: before.photoIds,
      after: after.photoIds,
      added: after.photoIds.filter((x) => !b.has(x)),
      removed: before.photoIds.filter((x) => !a.has(x)),
    });
  }
  if ((before.coverPhotoId ?? null) !== (after.coverPhotoId ?? null)) {
    changes.push({ path: 'coverPhotoId', before: before.coverPhotoId ?? null, after: after.coverPhotoId ?? null });
  }
  return changes;
}
