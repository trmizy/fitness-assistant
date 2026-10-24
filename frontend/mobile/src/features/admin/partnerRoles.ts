import { api } from "../../services/api";

const CHUNK = 200; // the endpoint accepts at most 200 ids per call

/**
 * B41 — `GET /admin/partner-accounts/roles?userIds=a,b` (admin only). Lives here rather than in
 * services/api.ts; it uses the same axios instance, so auth and token refresh behave identically.
 */
export async function fetchPartnerRoles(userIds: string[]): Promise<{ userId: string; partnerRole: string | null }[]> {
  const out: { userId: string; partnerRole: string | null }[] = [];
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const ids = userIds.slice(i, i + CHUNK);
    const { data } = await api.get("/admin/partner-accounts/roles", { params: { userIds: ids.join(",") } });
    const rows = data?.data ?? data;
    if (Array.isArray(rows)) out.push(...rows);
  }
  return out;
}
