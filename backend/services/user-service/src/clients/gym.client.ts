import axios from 'axios';

const GYM_SERVICE_URL = process.env.GYM_SERVICE_URL || 'http://localhost:3006';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

/** Which kind of PT↔gym agreement produced a rate table. Vocabulary owned by gym-service. */
export type GymAgreementScope = 'BRAND' | 'BRANCH';

export interface ActiveCollaborationRates {
  /** Id of the agreement that produced these rates (brand agreement id, or the legacy per-branch row id). */
  collaborationId: string;
  platformRate: string;
  ptRate: string;
  gymRate: string;
  /**
   * Phase 3 / P3.2 — OPTIONAL: gym-service may not send these (older build, or a build that has not
   * shipped the brandId addition yet). Absent / unrecognised → null, never a guess. Callers must treat
   * null as "gym-service did not say", not as "this gym has no brand".
   */
  brandId?: string | null;
  agreementScope?: GymAgreementScope | null;
}

/** One row of gym-service `GET /pt/:ptUserId/gyms` (the fields user-service reads). */
export interface AcceptedGymForPt {
  collaborationId: string;
  gym: { id: string; name: string; city?: string | null };
  rates?: { ptRate: string; gymRate: string; platformRate: string };
}

/** The part of gym-service `GET /internal/clients/:clientId/active-memberships?gymId=` user-service reads. */
export interface ClientMembershipLookup {
  hasActiveMembership: boolean;
  brandId: string | null;
  membership: {
    membershipId: string;
    planName: string;
    purchaseGymId: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
}

/** Only values gym-service is known to use; anything else is dropped rather than stored as an unreadable string. */
function readAgreementScope(raw: unknown): GymAgreementScope | null {
  return raw === 'BRAND' || raw === 'BRANCH' ? raw : null;
}

function readOptionalId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/**
 * Thrown when gym-service could not be reached at all — as opposed to answering "no
 * collaboration exists", which is a normal 404 the caller handles directly.
 *
 * The distinction matters (money-flow plan §1.4/B1): folding a network failure into "no
 * collaboration" would silently cost the gym its revenue share on every contract signed
 * during an outage — the platform keeps running, the numbers are just wrong, which is the
 * hardest kind of bug to notice.
 */
export class GymServiceUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`gym-service unreachable: ${(cause as Error)?.message ?? cause}`);
    this.name = 'GymServiceUnavailableError';
  }
}

export const gymClient = {
  /**
   * The frozen rate table for an accepted PT↔gym partnership, or null if the pair has no
   * active collaboration. Short timeout — there is no circuit breaker in front of this call,
   * so a slow gym-service must not be allowed to stall contract creation.
   */
  async getActiveCollaboration(gymId: string, ptUserId: string): Promise<ActiveCollaborationRates | null> {
    try {
      const { data } = await axios.get(`${GYM_SERVICE_URL}/internal/collaborations/active`, {
        params: { gymId, ptUserId },
        headers,
        timeout: 3_000,
      });
      const row = data.data as ActiveCollaborationRates;
      // Normalise the optional P3.2 fields to explicit null so downstream code never sees undefined.
      return { ...row, brandId: readOptionalId(row.brandId), agreementScope: readAgreementScope(row.agreementScope) };
    } catch (e: any) {
      if (e?.response?.status === 404) return null; // no accepted collaboration — not an error
      throw new GymServiceUnavailableError(e);
    }
  },

  /**
   * Phase 3 / P3.4 - the branches a trainer may be booked through, exactly as gym-service's client
   * gym picker lists them (public `GET /pt/:ptUserId/gyms`: APPROVED + OPEN branch, partner not
   * locked, agreement usable and not terminating - one shared resolution with getActiveCollaboration).
   * Any failure -> GymServiceUnavailableError: an unreachable gym-service must never read as "the
   * trainer has no gyms".
   */
  async listAcceptedGymsForPt(ptUserId: string): Promise<AcceptedGymForPt[]> {
    try {
      const { data } = await axios.get(`${GYM_SERVICE_URL}/pt/${encodeURIComponent(ptUserId)}/gyms`, {
        timeout: 3_000,
      });
      const rows = data?.data;
      if (!Array.isArray(rows)) throw new Error('unexpected gym-service answer');
      return rows as AcceptedGymForPt[];
    } catch (e: any) {
      throw new GymServiceUnavailableError(e);
    }
  },

  /**
   * Phase 3 / P3.4 - the client's active membership at the brand of `gymId` (gym-service P3.1,
   * read-only). Null when gym-service says the branch does not exist (404). Any other failure ->
   * GymServiceUnavailableError (never "no membership").
   */
  async getClientMembershipAtGym(clientUserId: string, gymId: string): Promise<ClientMembershipLookup | null> {
    try {
      const { data } = await axios.get(
        `${GYM_SERVICE_URL}/internal/clients/${encodeURIComponent(clientUserId)}/active-memberships`,
        { params: { gymId }, headers, timeout: 3_000 },
      );
      const row = data?.data;
      if (!row || typeof row.hasActiveMembership !== 'boolean') throw new Error('unexpected gym-service answer');
      return row as ClientMembershipLookup;
    } catch (e: any) {
      if (e?.response?.status === 404) return null;
      throw new GymServiceUnavailableError(e);
    }
  },
};
