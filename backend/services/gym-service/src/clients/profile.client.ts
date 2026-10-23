import axios from 'axios';
import { invokeHttpLambda, throwForLambdaHttpError } from './lambda-http.client';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

export const profileClient = {
  /** Resolves a PT's referral code (money-flow plan §2.1) to their userId, or null if unknown —
   * an invalid code is an ordinary user-input case for the caller to surface, not an error. */
  async resolveReferralCode(code: string): Promise<string | null> {
    try {
      if (process.env.USER_LAMBDA_NAME) {
        const result = await invokeHttpLambda({
          functionName: process.env.USER_LAMBDA_NAME,
          method: 'GET',
          path: `/internal/profile/by-referral-code/${encodeURIComponent(code)}`,
          headers,
        });
        if (result.statusCode === 404) return null;
        throwForLambdaHttpError(result);
        return result.body.userId as string;
      }

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

  /**
   * D15c — the member's profile photo (the only thing the front desk gets from the profile), for the PHOTO_MATCH identity
   * check. Reads user-service's existing internal profile route but KEEPS ONLY `photoUrl`: the rest of that payload
   * (body metrics, goals, health data) is dropped here and never reaches a response. Fail-closed: any failure or an empty
   * photo is `null` = "no photo on file", which makes PHOTO_MATCH unavailable rather than silently allowed.
   */
  async getProfilePhotoUrl(userId: string): Promise<string | null> {
    try {
      let body: any;
      const path = `/internal/profile/${encodeURIComponent(userId)}`;
      if (process.env.USER_LAMBDA_NAME) {
        const result = await invokeHttpLambda({ functionName: process.env.USER_LAMBDA_NAME, method: 'GET', path, headers });
        throwForLambdaHttpError(result);
        body = result.body;
      } else {
        body = (await axios.get(`${process.env.USER_SERVICE_URL || USER_SERVICE_URL}${path}`, { headers, timeout: 4_000 })).data;
      }
      const url = body?.profile?.photoUrl;
      return typeof url === 'string' && url.trim() ? url : null;
    } catch {
      return null;
    }
  },
};
