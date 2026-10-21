/**
 * ADMIN TOOLING - place or lift a legal hold on the IP / user agent of ONE row, so the 12-month retention sweep
 * (services/ip-ua-retention.service.ts) keeps them while a dispute needs them. Not an HTTP route on purpose: no public API sets
 * `legal_hold_until`.
 *
 *   tsx src/scripts/ip-ua-legal-hold.ts <terms|audit> <row-id> <until|clear>
 *
 *   <until>  an ISO-8601 instant in the future, e.g. 2027-12-31T00:00:00Z (the hold lapses then and the next sweep scrubs the row)
 *   clear    lifts the hold (the next sweep scrubs the row if it is past retention)
 *
 * Prints only the table, the row id and the outcome - never the IP or the user agent. Exit code 0 = done, 1 = nothing changed.
 * Placing a hold AFTER the sweep already scrubbed a row cannot bring the data back: place it before the 12 months run out.
 */
import { prisma } from "../repositories/profile.repository";

export type LegalHoldTarget = "terms" | "audit";

export function parseHoldUntil(raw: string, now: Date = new Date()): Date | null | "invalid" {
  if (raw === "clear") return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return "invalid"; // an instant WITH a zone, never a guess
  return t > now.getTime() ? new Date(t) : "invalid";
}

export async function setLegalHold(target: LegalHoldTarget, id: string, until: Date | null): Promise<number> {
  const data = { legalHoldUntil: until };
  return target === "terms"
    ? (await prisma.ptTermsAcceptance.updateMany({ where: { id }, data })).count
    : (await prisma.auditLog.updateMany({ where: { id }, data })).count;
}

async function main(argv: string[]) {
  const [target, id, rawUntil] = argv;
  if ((target !== "terms" && target !== "audit") || !id || !rawUntil) {
    console.error("usage: ip-ua-legal-hold.ts <terms|audit> <row-id> <ISO-8601 instant with zone | clear>");
    return 1;
  }
  const until = parseHoldUntil(rawUntil);
  if (until === "invalid") {
    console.error("until must be 'clear' or a FUTURE ISO-8601 instant with a time zone (e.g. 2027-12-31T00:00:00Z)");
    return 1;
  }
  const count = await setLegalHold(target, id, until);
  console.log(count === 1 ? `${target} ${id}: legal hold ${until ? `until ${until.toISOString()}` : "cleared"}` : `${target} ${id}: no such row, nothing changed`);
  return count === 1 ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (e) => {
      console.error(String((e as Error)?.message ?? e));
      await prisma.$disconnect();
      process.exit(1);
    });
}
