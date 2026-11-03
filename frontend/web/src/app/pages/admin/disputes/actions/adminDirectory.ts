/**
 * D3 - the ADMIN list the "Giao người phụ trách" form chooses from (never a typed id).
 * `GET /admin/users?role=ADMIN` is the gateway route that forwards the role filter to auth-service (C1-09); the answer is
 * `{ success, data: { total, users: [{ id, name, email, role, status, ... }] } }` and is turned into options by `parseAdminOptions`.
 * One plain read; it writes no access log and is never polled.
 */
import { api } from "../../../../services/api";
import { parseAdminOptions, type AdminOption } from "./actionModel";

export async function listAdminOptions(selfId: string | null): Promise<AdminOption[]> {
  const { data } = await api.get("/admin/users", { params: { role: "ADMIN" } });
  return parseAdminOptions(data, selfId);
}
