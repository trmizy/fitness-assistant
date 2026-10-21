import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { invokeHttpLambda, throwForLambdaHttpError } from './lambda-http.client';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

/** Hard ceiling for the PT session lookup, HTTP and Lambda alike (Phase 2 / Q16). */
export const PT_GYM_SESSIONS_TIMEOUT_MS = 3000;

export type PtBlockedReason = 'PT_NOT_FOUND' | 'NOT_A_PT' | 'PT_ACCOUNT_RESTRICTED' | 'PT_BANNED';

/** user-service's answer to GET /internal/pt/:ptUserId/gym-sessions (Phase 2 / P2.1 contract). */
export interface PtGymSessionsResponse {
  ptUserId: string;
  gymId: string;
  ptActive: boolean;
  ptBlockedReason: PtBlockedReason | null;
  sessions: Array<{
    sessionId: string;
    contractId: string;
    status: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
  }>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('user-service timeout'), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export const userClient = {
  /**
   * Phase 2 / P2.2 - the PT's qualifying in-person sessions at one branch in [from, to).
   * READ-ONLY. Unlike the best-effort helpers below this one THROWS on every failure (timeout,
   * network, non-2xx): the caller must never read "could not ask" as "no sessions today" (Q16).
   * user-service already applies the business rules (branch, OFFLINE, Q14 statuses, overlap,
   * restrictions, contract ending); this client only transports the answer.
   */
  async getPtGymSessions(params: { ptUserId: string; gymId: string; from: Date; to: Date }): Promise<PtGymSessionsResponse> {
    const path = `/internal/pt/${encodeURIComponent(params.ptUserId)}/gym-sessions`;
    const query = { gymId: params.gymId, from: params.from.toISOString(), to: params.to.toISOString() };

    if (process.env.USER_LAMBDA_NAME) {
      const result = await withTimeout(
        invokeHttpLambda({
          functionName: process.env.USER_LAMBDA_NAME,
          method: 'GET',
          path,
          headers,
          queryStringParameters: query,
        }),
        PT_GYM_SESSIONS_TIMEOUT_MS,
      );
      throwForLambdaHttpError(result);
      return result.body as PtGymSessionsResponse;
    }

    const { data } = await axios.get(`${USER_SERVICE_URL}${path}`, {
      headers,
      params: query,
      timeout: PT_GYM_SESSIONS_TIMEOUT_MS,
    });
    return data as PtGymSessionsResponse;
  },

  /**
   * D15 (lễ tân) - client ids that have a face-to-face PT session booked at this branch in [from, to). READ-ONLY and
   * best-effort by design: unlike getPtGymSessions this is a convenience list for the front desk, so any failure is
   * reported as `available: false` (the caller still shows check-ins) rather than thrown. Ids only - names are resolved
   * by gym-service from auth-service, never taken from here.
   */
  async getGymBookedClients(params: { gymId: string; from: Date; to: Date }): Promise<{ available: boolean; clients: Array<{ clientUserId: string; startAt: string }> }> {
    const path = `/internal/gyms/${encodeURIComponent(params.gymId)}/booked-clients`;
    const query = { from: params.from.toISOString(), to: params.to.toISOString() };
    try {
      let body: any;
      if (process.env.USER_LAMBDA_NAME) {
        const result = await withTimeout(
          invokeHttpLambda({ functionName: process.env.USER_LAMBDA_NAME, method: 'GET', path, headers, queryStringParameters: query }),
          PT_GYM_SESSIONS_TIMEOUT_MS,
        );
        throwForLambdaHttpError(result);
        body = result.body;
      } else {
        body = (await axios.get(`${USER_SERVICE_URL}${path}`, { headers, params: query, timeout: PT_GYM_SESSIONS_TIMEOUT_MS })).data;
      }
      if (!body || !Array.isArray(body.clients)) throw new Error('malformed booked-clients response');
      const clients = body.clients
        .filter((c: any) => c && typeof c.clientUserId === 'string' && c.clientUserId)
        .map((c: any) => ({ clientUserId: c.clientUserId as string, startAt: String(c.startAt) }));
      return { available: true, clients };
    } catch (e) {
      logger.warn({ err: (e as Error).message, gymId: params.gymId }, '[gym-service] booked-clients lookup unavailable');
      return { available: false, clients: [] };
    }
  },

  /**
   * Phase 5 — số hợp đồng PT đang ACTIVE tại các chi nhánh này, cho màn xác nhận chấm dứt
   * hợp tác. Không quan trọng bằng số hội viên (tiền chính nằm ở đó), nên lỗi mạng ở đây
   * không được chặn cả màn hình — trả 0 kèm cảnh báo log thay vì ném lỗi lên trên.
   */
  async countActivePtContractsByGyms(gymIds: string[]): Promise<number> {
    if (gymIds.length === 0) return 0;
    try {
      const { data } = await axios.post(
        `${USER_SERVICE_URL}/internal/contracts/count-active-by-gyms`,
        { gymIds },
        { headers, timeout: 5000 },
      );
      return data.count as number;
    } catch (e) {
      logger.error({ err: (e as Error).message }, '[gym-service] đếm hợp đồng PT thất bại — trả 0');
      return 0;
    }
  },

  /**
   * GYM_MANAGEMENT master spec, Phase 5 (Complaints) — "khách nhận thông báo khi xử lý
   * xong". Reuses user-service's existing generic `POST /internal/notifications` (built for
   * fitness-service's WORKOUT_* events) rather than inventing a second notification
   * pipeline — gym-service never had a write path into that table before this. Best-effort:
   * a failed notification must never fail the complaint resolution itself.
   */
  async notifyUser(params: { userId: string; text: string; eventType: string; entityType: string; entityId: string; link?: string }) {
    try {
      await axios.post(`${USER_SERVICE_URL}/internal/notifications`, params, { headers, timeout: 5000 });
    } catch (e) {
      logger.error({ err: (e as Error).message, userId: params.userId }, '[gym-service] gửi thông báo thất bại');
    }
  },
};
