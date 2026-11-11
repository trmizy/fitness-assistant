/**
 * B8 — typed READ client of GET /admin/payments/gateway-reconciliation (payment-service, via the gateway, ADMIN only).
 * Only `from` / `to` are ever sent. There is NO write call here and none may be added: this screen is read only (guarded by a source test).
 */
import { api } from "../../../../services/api";
import { GATEWAY_RECON_PATH, normalizeGatewayReport, toGatewayQuery, type DayRange, type GatewayReport } from "./gatewayReconciliationModel";

/** The slice of axios this module needs — a fake in tests. Read only: `get` and nothing else. */
export interface GatewayHttpClient {
  get(url: string, config?: { params?: Record<string, string> }): Promise<{ data: unknown }>;
}

/** Thrown when the server answered 2xx with a body that is not the documented report (a failure, never "no discrepancy"). */
export const malformedGatewayReport = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });
export const isMalformedGatewayReport = (e: unknown) => (e as { malformed?: boolean } | null)?.malformed === true;

export function createGatewayReconciliationApi(client: GatewayHttpClient) {
  return {
    async getReport(range: DayRange): Promise<GatewayReport> {
      const { data } = await client.get(GATEWAY_RECON_PATH, { params: toGatewayQuery(range) });
      const report = normalizeGatewayReport(data);
      if (!report) throw malformedGatewayReport();
      return report;
    },
  };
}

export const gatewayReconciliationApi = createGatewayReconciliationApi(api);
