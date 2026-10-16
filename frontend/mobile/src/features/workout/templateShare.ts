/**
 * 14B.6 (PG-B5, closes GAP-8) — who a workout template may be shared with: only people with an ACTIVE
 * coaching relationship to the user, in either direction (their clients when they coach, their PT when
 * they are coached). Same source as web TemplatesPage — never an open list of users, never a typed id.
 */
export type ShareContact = { userId: string; name: string; role: "client" | "pt" };

function rows(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  const r = raw as any;
  return Array.isArray(r?.contracts) ? r.contracts : Array.isArray(r?.data) ? r.data : [];
}

function personName(p: any, fallback: string): string {
  return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim() || p?.email || fallback;
}

export function shareContacts(ptContracts: unknown, clientContracts: unknown, selfId?: string | null): ShareContact[] {
  const out: ShareContact[] = [];
  for (const c of rows(ptContracts)) {
    if (c?.clientUserId) out.push({ userId: String(c.clientUserId), name: personName(c.clientProfile, "Học viên"), role: "client" });
  }
  for (const c of rows(clientContracts)) {
    if (c?.ptUserId) out.push({ userId: String(c.ptUserId), name: personName(c.ptProfile ?? c.pt, "Huấn luyện viên"), role: "pt" });
  }
  const seen = new Set<string>();
  return out.filter((c) => c.userId !== selfId && !seen.has(c.userId) && (seen.add(c.userId), true));
}
