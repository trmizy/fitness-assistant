/**
 * B8 L3 — typed READ client of GET /admin/payments/gateway-reconciliation/l3 (payment-service, via the gateway, ADMIN only).
 * Only `from` / `to` are ever sent. There is NO write call here and none may be added: the server only LOOKS UP VNPay (guarded by a source test).
 */
import { api } from "../../../../services/api";
import { L3_PATH, L3_REQUEST_TIMEOUT_MS, normalizeL3Report, toL3Query, type VnpayL3Report } from "./vnpayL3Model";
import type { DayRange } from "./gatewayReconciliationModel";

/** The slice of axios this module needs — a fake in tests. Read only: `get` and nothing else. */
export interface VnpayL3HttpClient {
  get(url: string, config?: { params?: Record<string, string>; timeout?: number }): Promise<{ data: unknown }>;
}

/** Thrown when the server answered 2xx with a body that is not the documented L3 report (a failure, never "no discrepancy"). */
export const malformedL3Report = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });

export function createVnpayL3Api(client: VnpayL3HttpClient) {
  return {
    async getReport(range: DayRange): Promise<VnpayL3Report> {
      const { data } = await client.get(L3_PATH, { params: toL3Query(range), timeout: L3_REQUEST_TIMEOUT_MS });
      const report = normalizeL3Report(data);
      if (!report) throw malformedL3Report();
      return report;
    },
  };
}

export const vnpayL3Api = createVnpayL3Api(api);
