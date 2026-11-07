/**
 * D3 - the ADMIN list the "Giao người phụ trách" form chooses from (never a typed id).
 * `GET /admin/dispute-cases/admins` (INT-01) answers `[{ id, displayName }]` of the active ADMINs; `parseAdminOptions` turns it into options.
 * (`GET /admin/users?role=ADMIN` is refused by the gateway: its role filter accepts only CUSTOMER, PT and GYM_OWNER.)
 * One plain read; it writes no access log and is never polled.
 */
import { api } from "../../../../services/api";
import { parseAdminOptions, type AdminOption } from "./actionModel";

export async function listAdminOptions(selfId: string | null): Promise<AdminOption[]> {
  const { data } = await api.get("/admin/dispute-cases/admins");
  return parseAdminOptions(data, selfId);
}
