import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";

/**
 * Admin dashboard numbers that leave test / seed accounts out, scaled for a system where nearly every account is a seed account.
 *
 * Before: the route got every account from auth-service, derived the test ids in memory and filtered with Prisma `notIn: testIds` (twice per
 * query: client and trainer). With 37k test accounts that is 74k bind parameters per query; Postgres allows 32767, so the query failed and
 * the dashboard degraded to "partial data". Now the ids travel as ONE JSON parameter (`jsonb_array_elements_text`), whatever their number.
 */

const ids = (list: string[]) => JSON.stringify(list);
const notIn = (column: Prisma.Sql, json: string) => Prisma.sql`${column} NOT IN (SELECT jsonb_array_elements_text(${json}::jsonb))`;

/** ACTIVE contracts whose client AND trainer are both real accounts and that are not marked SYNTHETIC. */
export async function countActiveContractsExcluding(testIds: string[]): Promise<number> {
  const json = ids(testIds);
  const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(*) AS n FROM "contracts"
    WHERE "status" = 'ACTIVE' AND "data_origin" <> 'SYNTHETIC'
      AND ${notIn(Prisma.sql`"client_user_id"`, json)} AND ${notIn(Prisma.sql`"pt_user_id"`, json)}`);
  return Number(row?.n ?? 0);
}

/** InBody entries created since `since`, by status, for real accounts only. */
export async function ocrStatsExcluding(testIds: string[], since: Date) {
  const json = ids(testIds);
  const rows = await prisma.$queryRaw<Array<{ status: string; n: bigint }>>(Prisma.sql`
    SELECT "status", count(*) AS n FROM "inbody_entries"
    WHERE "created_at" >= ${since} AND ${notIn(Prisma.sql`"user_id"`, json)}
    GROUP BY "status"`);
  const count = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return {
    total: rows.reduce((acc, r) => acc + Number(r.n), 0),
    extracted: count("extracted"),
    manual: count("manual"),
    pending: count("pending"),
  };
}

/** Sessions that start in [start, end), not requested/cancelled, between real accounts only. */
export async function sessionsTodayExcluding(testIds: string[], start: Date, end: Date): Promise<number> {
  const json = ids(testIds);
  const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(*) AS n FROM "sessions"
    WHERE "scheduled_start_at" >= ${start} AND "scheduled_start_at" < ${end}
      AND "status" NOT IN ('REQUESTED', 'CANCELLED')
      AND ${notIn(Prisma.sql`"client_user_id"`, json)} AND ${notIn(Prisma.sql`"pt_user_id"`, json)}`);
  return Number(row?.n ?? 0);
}

// ── test account ids (auth-service owns the rule: reserved never-deliverable email domains) ─────────────────────────────────────────

const TEST_IDS_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; ids: string[] } | null = null;

/** Ids of the accounts on reserved test email domains, cached for 5 minutes (the same TTL gym / payment / ai use). null = could not be read. */
export async function getAuthTestAccountIds(now = Date.now()): Promise<string[] | null> {
  if (cache && now - cache.at < TEST_IDS_TTL_MS) return cache.ids;
  try {
    const { data } = await authServiceClient.internalGet("/auth/internal/test-account-ids", { timeoutMs: 8000 });
    const list = Array.isArray(data?.ids) ? (data.ids as unknown[]).filter((x): x is string => typeof x === "string") : null;
    if (!list) return null;
    cache = { at: now, ids: list };
    return list;
  } catch {
    return null;
  }
}

/** TEST SEAM */
export function __resetTestAccountIdsCache(): void {
  cache = null;
}
