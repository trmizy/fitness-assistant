/**
 * N15B-06: "Cần chốt buổi" - in-person sessions that ended but were never closed. The server list (`GET /sessions/awaiting-completion`)
 * already holds only the PT's CONFIRMED sessions past their end on a running contract; an ONLINE session is decided by the room-close
 * sweep (see PTSchedulePage), so it is not offered a manual "Hoàn thành". Pure (runs under `npx tsx --test`).
 */
interface SessionLike {
  id: string;
  status: string;
  sessionMode?: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
}

export function sessionsToClose<T extends SessionLike>(rows: T[] | null | undefined, now: number = Date.now()): T[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((s) => s.status === "CONFIRMED" && s.sessionMode !== "ONLINE" && Date.parse(s.scheduledEndAt) <= now)
    .sort((a, b) => Date.parse(b.scheduledStartAt) - Date.parse(a.scheduledStartAt));
}

/** "18:30 – 19:30, 12/11/2026" in Vietnamese. */
export function sessionWhenLabel(s: Pick<SessionLike, "scheduledStartAt" | "scheduledEndAt">): string {
  const start = new Date(s.scheduledStartAt);
  const end = new Date(s.scheduledEndAt);
  if (Number.isNaN(start.getTime())) return "Buổi tập";
  const hm = (d: Date) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const day = start.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  return Number.isNaN(end.getTime()) ? `${hm(start)}, ${day}` : `${hm(start)} – ${hm(end)}, ${day}`;
}
