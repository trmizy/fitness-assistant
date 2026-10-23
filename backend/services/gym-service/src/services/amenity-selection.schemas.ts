import { z } from 'zod';
import { AMENITY_CATEGORIES } from './amenity-catalog';
import { MAX_AMENITIES_PER_GYM, proposalNameField } from './gym-listing.schemas';

/**
 * Listing Management B3 - the zod fields shared by every body that carries an amenity selection for a branch with no published
 * listing yet: PUT /owner/application/amenities, POST /owner/gyms (quick create) and PATCH /owner/gyms/:id/draft.
 * Pure (no database), so request validation and unit tests can import it freely.
 */
export const MAX_INLINE_PROPOSALS = 10;

/** `proposals: [{ name, suggestedCategory, note? }]` */
export const inlineProposalSchema = z
  .object({
    name: proposalNameField,
    suggestedCategory: z.enum(AMENITY_CATEGORIES),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * `amenityIds` (catalogue ids, authoritative when present; the 18 SYSTEM rows are 'amenity-sys-<slug>', so not UUIDs),
 * `proposals` (new custom ones) and `proposalIds` (own PENDING proposals, UUIDs, to keep).
 */
export const amenitySelectionFields = {
  amenityIds: z.array(z.string().trim().min(1).max(100)).max(MAX_AMENITIES_PER_GYM).optional(),
  proposals: z.array(inlineProposalSchema).max(MAX_INLINE_PROPOSALS).optional(),
  proposalIds: z.array(z.string().uuid()).max(MAX_INLINE_PROPOSALS * 5).optional(),
};

export const applicationAmenitiesSchema = z.object(amenitySelectionFields).strict();
