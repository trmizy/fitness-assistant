/**
 * FIX2-ADMIN Q7 (15/11/2026) - "Yêu cầu bổ sung" of a gym case can ask the member, the gym or both. What the admin must see BEFORE sending is
 * which response clock each asked party gets. The rule is the server's (gym-service complaint-case/deadlines.service.ts + rules.ts):
 *   - the clock starts only for a request that moves the case to AWAITING_PARTIES, and only from a notice that was really DELIVERED in the app;
 *   - a party's FIRST request gets 72 hours, every later one (a supplement round) 48 hours;
 *   - a party that still has an OPEN clock keeps it (a second request does not restart it).
 * Pure (no React): runs under `npx tsx --test`.
 */

export const FIRST_RESPONSE_HOURS = 72;
export const SUPPLEMENT_ROUND_HOURS = 48;

export type AskChoice = "MEMBER" | "GYM" | "BOTH";
export type AskParty = "MEMBER" | "GYM";

export const ASK_CHOICES: ReadonlyArray<{ value: AskChoice; label: string }> = [
  { value: "MEMBER", label: "Khách" },
  { value: "GYM", label: "Phòng gym" },
  { value: "BOTH", label: "Cả hai" },
];

export const PARTY_LABEL: Record<AskParty, string> = { MEMBER: "Khách", GYM: "Phòng gym" };

export const partiesOf = (choice: AskChoice): AskParty[] => (choice === "BOTH" ? ["MEMBER", "GYM"] : [choice]);

export interface DeadlineRow {
  kind?: string;
  party?: string;
  partyRole?: string;
  dueAt?: string | null;
  effectiveDueAt?: string | null;
  status?: string;
  paused?: boolean | null;
}

export interface ClockPreview {
  party: AskParty;
  /** "FIRST_RESPONSE" = this party was never asked with a clock; "SUPPLEMENT_ROUND" = it already had one. */
  kind: "FIRST_RESPONSE" | "SUPPLEMENT_ROUND";
  hours: number;
  /** a clock of this party is still running: it is kept, nothing new starts */
  running: { dueAt: string } | null;
  /** when the new clock would end if the notice were delivered right now (null while an old clock keeps running) */
  endsIfSentAt: Date | null;
}

const roleOf = (d: DeadlineRow) => d.partyRole ?? d.party;

/** What each asked party will get. `now` is injected for tests. */
export function previewResponseClocks(deadlines: readonly DeadlineRow[] | undefined, parties: readonly AskParty[], now: Date = new Date()): ClockPreview[] {
  const rows = deadlines ?? [];
  return parties.map((party) => {
    const mine = rows.filter((d) => roleOf(d) === party);
    const open = mine.find((d) => d.status === "OPEN");
    const kind = mine.length === 0 ? "FIRST_RESPONSE" : "SUPPLEMENT_ROUND";
    const hours = kind === "FIRST_RESPONSE" ? FIRST_RESPONSE_HOURS : SUPPLEMENT_ROUND_HOURS;
    const runningDue = open ? open.effectiveDueAt ?? open.dueAt ?? null : null;
    return {
      party,
      kind,
      hours,
      running: open && runningDue ? { dueAt: runningDue } : null,
      endsIfSentAt: open ? null : new Date(now.getTime() + hours * 3600 * 1000),
    };
  });
}

/** One sentence per party for the form ("Khách: 72 giờ (lần phản hồi đầu), hết hạn khoảng 18/11/2026 10:00 nếu gửi bây giờ."). */
export function clockSentence(p: ClockPreview, format: (d: Date | string) => string): string {
  const who = PARTY_LABEL[p.party];
  if (p.running) return `${who}: đang có hạn phản hồi chạy đến ${format(p.running.dueAt)} — giữ nguyên, không tính lại.`;
  const round = p.kind === "FIRST_RESPONSE" ? "lần phản hồi đầu" : "vòng bổ sung";
  return `${who}: ${p.hours} giờ (${round}), hết hạn khoảng ${format(p.endsIfSentAt as Date)} nếu gửi bây giờ.`;
}
