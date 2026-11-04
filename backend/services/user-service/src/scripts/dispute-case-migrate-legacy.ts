/**
 * DISPUTE CASE slice 2 / S2.2 - moves the sessions that are ALREADY DISPUTED / PT_NO_SHOW_REPORTED into the Case workflow (design 1.7.4 step 3).
 *
 * For every such session that has no Case (no case in any status other than REJECTED_INTAKE), it opens one with the Slice 1 intake
 * (disputeCaseService.openCase): sessions.pt_notes / dispute_reason become statement v1 (source LEGACY_FIELD), every source is collected read-only,
 * a session without a dispute_type becomes the provisional LEGACY_UNCLASSIFIED. It NEVER changes a session, a quota, a settlement or money (intake only
 * reads those); disputed_at stays where it is, so the D61 clock keeps its original start.
 *
 *   DRY-RUN (default)  lists what would be created; writes nothing.
 *   --apply            writes, and ONLY when the test preload accepted an isolated *_test database (DB_ISOLATION === "accepted"); otherwise it refuses.
 *   idempotent         a session that has a Case (made by an earlier run or by an admin) is skipped; two runs create the same cases once.
 *
 *   TEST_DATABASE_URL="postgresql://gymcoach_test:...@localhost:55433/<x>_test?schema=public" \
 *     tsx --import ./src/__tests__/setup/db-isolation.ts src/scripts/dispute-case-migrate-legacy.ts [--apply]
 */
import { prisma } from "../repositories/profile.repository";
import { disputeCaseService } from "../services/dispute-case/dispute-case.service";

export const MIGRATION_ACTOR = { id: "system:dispute-case-legacy-migration", role: "ADMIN" } as const;

export interface LegacyCandidate {
  sessionId: string;
  contractId: string;
  status: string;
  disputeType: string | null;
  disputedAt: string | null;
  willBeType: string;
}
export interface LegacyReport {
  mode: "DRY_RUN" | "APPLY";
  candidates: LegacyCandidate[];
  created: Array<{ sessionId: string; caseId: string }>;
  skippedAlreadyHaveCase: number;
}

export function applyAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DB_ISOLATION === "accepted";
}

const typeFor = (status: string, disputeType: string | null) =>
  status === "PT_NO_SHOW_REPORTED" ? "PT_NO_SHOW_CLAIM" : disputeType === "CLIENT_NO_SHOW_CLAIM" ? "PT_CLIENT_NO_SHOW_CLAIM" : disputeType === "DELIVERY_DISPUTE" ? "PT_DELIVERY" : "LEGACY_UNCLASSIFIED";

export async function runLegacyMigration(o: { apply: boolean; env?: NodeJS.ProcessEnv }): Promise<LegacyReport> {
  if (o.apply && !applyAllowed(o.env)) {
    throw Object.assign(new Error("REFUSED: --apply only runs when the test preload accepted an isolated *_test database (DB_ISOLATION=accepted)."), { code: "APPLY_REFUSED" });
  }
  const sessions = await prisma.session.findMany({
    where: { status: { in: ["DISPUTED", "PT_NO_SHOW_REPORTED"] } },
    select: { id: true, contractId: true, status: true, disputeType: true, disputedAt: true },
    orderBy: [{ disputedAt: "asc" }, { id: "asc" }],
  });
  const withCase = new Set(
    (await prisma.disputeCase.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) }, status: { notIn: ["REJECTED_INTAKE", "CLOSED"] } }, select: { sessionId: true } })).map((c) => c.sessionId),
  );
  const candidates: LegacyCandidate[] = sessions
    .filter((s) => !withCase.has(s.id))
    .map((s) => ({ sessionId: s.id, contractId: s.contractId, status: s.status, disputeType: s.disputeType, disputedAt: s.disputedAt ? s.disputedAt.toISOString() : null, willBeType: typeFor(s.status, s.disputeType) }));
  const report: LegacyReport = { mode: o.apply ? "APPLY" : "DRY_RUN", candidates, created: [], skippedAlreadyHaveCase: sessions.length - candidates.length };
  if (!o.apply) return report;
  for (const c of candidates) {
    const r = await disputeCaseService.openCase(MIGRATION_ACTOR, c.sessionId, `legacy-migrate-${c.sessionId}`.slice(0, 128));
    if (r.result.created) report.created.push({ sessionId: c.sessionId, caseId: r.result.case.id });
  }
  return report;
}

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  runLegacyMigration({ apply })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(String(e?.message ?? e));
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    });
}
