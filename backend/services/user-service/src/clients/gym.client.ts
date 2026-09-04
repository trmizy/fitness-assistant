import axios from 'axios';

const GYM_SERVICE_URL = process.env.GYM_SERVICE_URL || 'http://localhost:3006';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

export interface ActiveCollaborationRates {
  collaborationId: string;
  platformRate: string;
  ptRate: string;
  gymRate: string;
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
      return data.data as ActiveCollaborationRates;
    } catch (e: any) {
      if (e?.response?.status === 404) return null; // no accepted collaboration — not an error
      throw new GymServiceUnavailableError(e);
    }
  },
};
