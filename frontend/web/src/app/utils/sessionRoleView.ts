/**
 * A PT can also train as a client of another PT, and `/sessions/upcoming` returns both kinds of session (where the
 * user is the PT OR the client). The two calendars must not mix: the PT schedule / dashboard show only the sessions
 * the user TEACHES, the client booking page only the sessions the user ATTENDS.
 *
 * The server does the split (`?as=pt|client`); the same filter is applied here as well so an older server that
 * ignores the parameter still yields the right list. The query key is role-scoped AND identity-scoped so the two lists
 * never share a cache entry and an account switch never shows the previous user's rows. Every existing
 * `invalidateQueries({ queryKey: ["sessions-upcoming"] })` still matches both (prefix match).
 */
export type SessionRole = "pt" | "client";

export const upcomingSessionsKey = (role: SessionRole, userId: string | null | undefined) =>
  ["sessions-upcoming", role, userId ?? "anon"] as const;

type SessionLike = { ptUserId?: string | null; clientUserId?: string | null };

export function sessionsForRole<T extends object>(sessions: readonly T[] | null | undefined, role: SessionRole, userId: string | null | undefined): T[] {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!userId) return [...list];
  return list.filter((s) => {
    const row = s as SessionLike;
    return role === "pt" ? row.ptUserId === userId : row.clientUserId === userId;
  });
}
