/**
 * Pure logic behind booking several slots at once on the client booking page - nothing here knows React or the network.
 * Mirrors the server's `POST /sessions/batch` rules only so the page can say "no" early; the server is the authority and
 * answers a refusal per slot (`slotErrors`).
 *  - at most MAX_BATCH_SESSIONS slots per request
 *  - at most MAX_SESSIONS_PER_DAY live sessions per client per day (a pending REQUESTED one counts), the batch included
 *  - never more than the contract has left
 *
 * Run: npx tsx --test src/app/utils/__tests__/batchBooking.test.ts
 */

export const MAX_BATCH_SESSIONS = 10;
export const MAX_SESSIONS_PER_DAY = 2;

export interface PickedSlot {
  /** YYYY-MM-DD */
  dateStr: string;
  /** HH:mm */
  slot: string;
}

export const slotKey = (p: PickedSlot): string => `${p.dateStr} ${p.slot}`;

const WEEKDAY = ["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"];

/** "Th 6, 10/05 · 07:00" */
export function slotLabel(p: PickedSlot): string {
  const [y, m, d] = p.dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY[date.getDay()]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${p.slot}`;
}

export function sortSlots(list: PickedSlot[]): PickedSlot[] {
  return [...list].sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
}

/** Add a slot if every rule allows it; otherwise the list comes back unchanged with the reason (Vietnamese). */
export function addSlot(
  list: PickedSlot[],
  p: PickedSlot,
  opts: { sessionsLeft: number },
): { list: PickedSlot[]; error: string | null } {
  if (list.some((s) => slotKey(s) === slotKey(p))) return { list, error: "Khung giờ này đã có trong danh sách." };
  if (list.length >= MAX_BATCH_SESSIONS) return { list, error: `Mỗi lần chỉ đặt được tối đa ${MAX_BATCH_SESSIONS} buổi.` };
  if (list.length >= opts.sessionsLeft) return { list, error: `Gói chỉ còn ${Math.max(0, opts.sessionsLeft)} buổi để đặt.` };
  if (list.filter((s) => s.dateStr === p.dateStr).length >= MAX_SESSIONS_PER_DAY) {
    return { list, error: `Mỗi ngày chỉ đặt tối đa ${MAX_SESSIONS_PER_DAY} buổi — hãy chọn ngày khác.` };
  }
  return { list: sortSlots([...list, p]), error: null };
}

export function removeSlot(list: PickedSlot[], p: PickedSlot): PickedSlot[] {
  return list.filter((s) => slotKey(s) !== slotKey(p));
}

/** Click on a slot button: picked -> unpicked, otherwise added (when allowed). */
export function toggleSlot(
  list: PickedSlot[],
  p: PickedSlot,
  opts: { sessionsLeft: number },
): { list: PickedSlot[]; error: string | null } {
  return list.some((s) => slotKey(s) === slotKey(p)) ? { list: removeSlot(list, p), error: null } : addSlot(list, p, opts);
}

/** The body of `POST /sessions/batch` (the contract id is added by the service call). */
export function buildBatchPayload(input: { slots: PickedSlot[]; sessionMode?: string | null; notes?: string }) {
  const notes = input.notes?.trim();
  return {
    slots: sortSlots(input.slots).map((s) => ({ scheduledDate: s.dateStr, scheduledTime: s.slot })),
    ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** A refused batch (axios error): the reason per slot, keyed by `slotKey`, and the headline. */
export function readBatchRejection(error: unknown): { bySlot: Record<string, string>; headline: string | null } {
  const data = (error as any)?.response?.data;
  const bySlot: Record<string, string> = {};
  if (Array.isArray(data?.slotErrors)) {
    for (const row of data.slotErrors) {
      const date = String(row?.scheduledDate ?? "");
      const time = String(row?.scheduledTime ?? "");
      if (date && time) bySlot[`${date} ${time}`] = String(row?.error ?? row?.message ?? "Khung giờ không đặt được");
    }
  }
  return { bySlot, headline: typeof data?.error === "string" && data.error ? data.error : null };
}
