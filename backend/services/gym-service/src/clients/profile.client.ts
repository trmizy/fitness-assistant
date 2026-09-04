import axios from 'axios';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

export const profileClient = {
  /** Resolves a PT's referral code (money-flow plan §2.1) to their userId, or null if unknown —
   * an invalid code is an ordinary user-input case for the caller to surface, not an error. */
  async resolveReferralCode(code: string): Promise<string | null> {
    try {
      const { data } = await axios.get(`${USER_SERVICE_URL}/internal/profile/by-referral-code/${encodeURIComponent(code)}`, {
        headers,
        timeout: 5_000,
      });
      return data.userId as string;
    } catch (e: any) {
      if (e?.response?.status === 404) return null;
      throw e; // a real outage — the caller decides how to surface this
    }
  },
};
