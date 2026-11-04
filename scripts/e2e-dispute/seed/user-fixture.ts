/**
 * E2E_DISPUTE fixture, user-service side. Copied to /app/backend/services/user-service/ and run INSIDE the e2e user-service container with that service's own Prisma client (never on the host, never against
 * another database: it refuses unless DATABASE_URL names gymini_user_e2e). Evidence label of everything written here: TEST FIXTURE.
 *   - UserProfile rows for the client and the PT (isPT), PT terms confirmation (D25)
 *   - one contract PENDING_PAYMENT (it is PAID afterwards through the real pay API + the payment-service demo checkout - no ledger row is written here)
 *   - sessions in the states the real APIs start from: S_DISPUTE (PENDING_CLIENT_CONFIRMATION, the client disputes it via POST /sessions/:id/dispute),
 *     S_NOSHOW (CONFIRMED, started > grace ago, the client reports the PT no-show via POST /sessions/:id/report-no-show)
 * Idempotent: a second run with the same marker reuses the contract.
 * Input env: E2E_CLIENT_ID, E2E_PT_ID.   Output: one JSON line "FIXTURE_JSON {...}".
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "./src/generated/prisma";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NAME = "E2E_DISPUTE paid contract";

async function main() {
  if (!/\/gymini_user_e2e(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing: DATABASE_URL is not the gymini_user_e2e database");
  const { E2E_CLIENT_ID: clientUserId, E2E_PT_ID: ptUserId } = process.env;
  if (!clientUserId || !ptUserId) throw new Error("E2E_CLIENT_ID / E2E_PT_ID required");
  const db = new PrismaClient();
  try {
    for (const [userId, isPT] of [[clientUserId, false], [ptUserId, true]] as const) {
      await db.userProfile.upsert({ where: { userId }, update: { isPT }, create: { userId, isPT } });
    }
    const { PT_TERMS_VERSION } = await import("./src/services/pt-terms");
    await db.ptTermsAcceptance.upsert({
      where: { userId_version: { userId: ptUserId, version: PT_TERMS_VERSION } },
      update: {},
      create: { userId: ptUserId, version: PT_TERMS_VERSION, source: "RECONFIRM" },
    });
    let contract = await db.contract.findFirst({ where: { packageName: NAME, clientUserId, ptUserId } });
    let created = false;
    if (!contract) {
      contract = await db.contract.create({
        data: {
          id: randomUUID(),
          ptUserId,
          clientUserId,
          packageName: NAME,
          totalSessions: 4,
          price: 1_000_000,
          status: "PENDING_PAYMENT",
          paymentDueAt: new Date(Date.now() + 6 * HOUR),
          sessionDurationMinutes: 60,
          startDate: new Date(Date.now() - 10 * DAY),
          endDate: new Date(Date.now() + 60 * DAY),
        },
      });
      created = true;
    }
    const mk = (status: string, start: Date, extra: Record<string, unknown> = {}) =>
      db.session.create({
        data: { id: randomUUID(), contractId: contract!.id, ptUserId, clientUserId, status: status as any, scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + HOUR), ...extra },
      });
    const find = (tag: string) => db.session.findFirst({ where: { contractId: contract!.id, ptNotes: { contains: tag } }, select: { id: true, status: true } });
    if (created) {
      const T = Date.now();
      await mk("PENDING_CLIENT_CONFIRMATION", new Date(T - 2 * DAY), { clientConfirmDeadline: new Date(T + 2 * DAY), sessionMode: "OFFLINE", ptNotes: "E2E_DISPUTE:dispute-fixture PT báo đã dạy đủ buổi" });
      await mk("CONFIRMED", new Date(T - 3 * DAY), { sessionMode: "OFFLINE", ptNotes: "E2E_DISPUTE:noshow-fixture" });
    }
    const sDispute = await find("E2E_DISPUTE:dispute-fixture");
    const sNoShow = await find("E2E_DISPUTE:noshow-fixture");
    console.log("FIXTURE_JSON " + JSON.stringify({ contractId: contract.id, status: contract.status, created, disputeSession: sDispute, noShowSession: sNoShow }));
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
