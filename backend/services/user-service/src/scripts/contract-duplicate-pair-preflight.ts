/**
 * CONTRACT DUPLICATE-PAIR PREFLIGHT (BR-27 / Codex #1) - READ ONLY.
 *
 * Migration 20261021140000_contract_one_live_per_pair_enforce creates the partial unique index
 * `contracts_one_live_per_pair` (pt_user_id, client_user_id) over the live statuses
 * (PENDING_REVIEW, PENDING_SIGNATURE, PENDING_PAYMENT, ACTIVE), MARKETPLACE contracts excluded. It REFUSES to run
 * (RAISE EXCEPTION, `prisma migrate deploy` stops) while any pair still has two or more live contracts. Run THIS script
 * BEFORE deploying to find out, and again after remediation to confirm there is nothing left.
 *
 * What it prints: how many pairs are duplicated and, per pair, the contract ids with status / source / paid or not /
 * created-at. No names, e-mails or user ids are printed (a pair is labelled P1, P2, ...). Connection strings are never printed.
 * Exit code: 0 = no duplicate live pair (the migration will pass), 1 = at least one pair (the migration would fail),
 * 2 = the script could not run (no / bad database url).
 * The whole run is one `SET TRANSACTION READ ONLY` transaction: the database itself refuses a write.
 *
 * USAGE (from backend/services/user-service):
 *   USER_DATABASE_URL=postgresql://... ./node_modules/.bin/tsx src/scripts/contract-duplicate-pair-preflight.ts [--json out.json]
 *   (DATABASE_URL is used when USER_DATABASE_URL is not set)
 *
 * REMEDIATION PROCEDURE (needs the owner's approval PER PAIR; this script changes nothing and a fix is never automatic)
 *   Rule: contracts and payment transactions are NEVER deleted, and no row is edited by hand. A duplicate is closed through
 *   the normal application path, which writes the audit trail, notifies both parties and releases any hold.
 *   1. Take a backup of the contracts table (or a database snapshot) before any change on a real database.
 *   2. For each pair the script marks one of:
 *        RESOLVABLE   at most one of the contracts has money behind it (payment_transaction_id set, or status ACTIVE).
 *                     Keep that one (if none is paid: the furthest along - ACTIVE > PENDING_PAYMENT > PENDING_SIGNATURE >
 *                     PENDING_REVIEW, the oldest on a tie). Cancel every other contract of the pair - they are unpaid -
 *                     with the owner's approval, as the PT or the client of that contract:
 *                       PATCH /contracts/:id/cancel   { "reason": "..." }      (writes the audit row, notifies the other party)
 *                     No payment-service call is needed: an unpaid contract has no money to return.
 *        ESCALATE     two or more contracts of the pair are paid / ACTIVE. Cancelling would have to refund or reassign money,
 *                     which is a finance decision, not a clean-up step: hand the pair to the owner / finance with the ids
 *                     below. Use the existing refund / contract-ending flows; do not touch the rows.
 *   3. Re-run this script until it exits 0.
 *   4. If `prisma migrate deploy` already ran and the enforce migration is recorded as failed, mark the failed attempt
 *      and deploy again:
 *        prisma migrate resolve --rolled-back 20261021140000_contract_one_live_per_pair_enforce
 *        prisma migrate deploy
 *   Marketplace (personalized-service) contracts are not part of the rule: a client may hold several of them with one PT.
 */
import fs from "node:fs";
import { PrismaClient } from "../generated/prisma";

export const LIVE_STATUSES = ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "ACTIVE"] as const;
const STATUS_RANK: Record<string, number> = { ACTIVE: 0, PENDING_PAYMENT: 1, PENDING_SIGNATURE: 2, PENDING_REVIEW: 3 };

export interface DuplicateContract {
  contractId: string;
  status: string;
  source: string;
  hasPayment: boolean;
  createdAt: string;
}
export interface DuplicatePair {
  label: string;
  verdict: "RESOLVABLE" | "ESCALATE";
  /** the contract the procedure suggests keeping (RESOLVABLE only) */
  keep: string | null;
  contracts: DuplicateContract[];
}
export interface PreflightReport {
  duplicatePairs: number;
  pairs: DuplicatePair[];
}

type Queryable = { $queryRawUnsafe: <T = unknown>(sql: string, ...values: unknown[]) => Promise<T> };

/** The one query: every live non-marketplace contract that shares its (pt, client) pair with another live one. */
export async function findDuplicateLivePairs(db: Queryable): Promise<PreflightReport> {
  const rows = await db.$queryRawUnsafe<
    { id: string; pair: string; status: string; source: string; has_payment: boolean; created_at: Date }[]
  >(
    `SELECT c."id", c."pt_user_id" || ':' || c."client_user_id" AS pair, c."status"::text AS status, c."source"::text AS source,
            (c."payment_transaction_id" IS NOT NULL) AS has_payment, c."created_at"
       FROM "contracts" c
      WHERE c."status"::text IN ('PENDING_REVIEW','PENDING_SIGNATURE','PENDING_PAYMENT','ACTIVE')
        AND c."source"::text <> 'MARKETPLACE'
        AND (c."pt_user_id", c."client_user_id") IN (
              SELECT "pt_user_id", "client_user_id" FROM "contracts"
               WHERE "status"::text IN ('PENDING_REVIEW','PENDING_SIGNATURE','PENDING_PAYMENT','ACTIVE')
                 AND "source"::text <> 'MARKETPLACE'
               GROUP BY "pt_user_id", "client_user_id" HAVING count(*) > 1)
      ORDER BY pair, c."created_at", c."id"`,
  );
  const byPair = new Map<string, DuplicateContract[]>();
  for (const r of rows) {
    const list = byPair.get(r.pair) ?? [];
    list.push({
      contractId: r.id,
      status: r.status,
      source: r.source,
      hasPayment: r.has_payment,
      createdAt: new Date(r.created_at).toISOString(),
    });
    byPair.set(r.pair, list);
  }
  const pairs: DuplicatePair[] = [...byPair.values()].map((contracts, i) => {
    const moneyBacked = contracts.filter((c) => c.hasPayment || c.status === "ACTIVE");
    const verdict = moneyBacked.length >= 2 ? "ESCALATE" : "RESOLVABLE";
    const keeper =
      verdict === "ESCALATE"
        ? null
        : (moneyBacked[0] ??
          [...contracts].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.createdAt.localeCompare(b.createdAt))[0]);
    return { label: `P${i + 1}`, verdict, keep: keeper?.contractId ?? null, contracts };
  });
  return { duplicatePairs: pairs.length, pairs };
}

export async function runPreflight(url: string): Promise<PreflightReport> {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return findDuplicateLivePairs(tx as unknown as Queryable);
    });
  } finally {
    await prisma.$disconnect();
  }
}

export function formatReport(report: PreflightReport): string {
  if (report.duplicatePairs === 0) return "OK: no PT-client pair has more than one live contract. The unique-index migration will pass.";
  const lines = [
    `BLOCKED: ${report.duplicatePairs} PT-client pair(s) have more than one live contract. The unique-index migration would FAIL.`,
    "Nothing was changed. See the REMEDIATION PROCEDURE in the header of this script (owner approval per pair; never delete).",
  ];
  for (const p of report.pairs) {
    lines.push(`  ${p.label} ${p.verdict}${p.keep ? ` (suggested keep: ${p.keep})` : ""}`);
    for (const c of p.contracts) {
      lines.push(`    ${c.contractId}  ${c.status}  ${c.source}  ${c.hasPayment ? "PAID" : "unpaid"}  ${c.createdAt}`);
    }
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const url = process.env.USER_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set USER_DATABASE_URL (or DATABASE_URL) to the user-service database.");
    return 2;
  }
  const jsonIdx = process.argv.indexOf("--json");
  let report: PreflightReport;
  try {
    report = await runPreflight(url);
  } catch (e) {
    console.error(`Preflight could not run: ${(e as Error).message.split("\n")[0]}`);
    return 2;
  }
  console.log(formatReport(report));
  if (jsonIdx >= 0 && process.argv[jsonIdx + 1]) fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2));
  return report.duplicatePairs === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
