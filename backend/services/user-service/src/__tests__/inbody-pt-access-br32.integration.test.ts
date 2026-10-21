import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContractStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { inbodyService } from "../services/inbody.service";

/**
 * Audit finding #9 - which contract states let a PT read a client's InBody history through user-service
 * (GET /inbody/client/:clientUserId -> inbodyService.getClientHistory).
 *
 * CHARACTERIZATION of the written rule BR-32 ("ACTIVE or COMPLETED contract"), BACKEND INTEGRATION on an isolated
 * `*_test` database. It pins today's behaviour so a change is a conscious product decision, NOT because anyone approved it:
 * a COMPLETED contract keeps the PT's read access to the client's FULL InBody history forever (no expiry, no client
 * consent step). fitness-service's own PT surface (coach.service.ts getClientProgress) is stricter - ACTIVE only,
 * 8 most recent entries, 4 fields. If the owner decides PT access ends with the contract, flip the COMPLETED assertion.
 */

const createdIds: string[] = [];
async function seed(ptUserId: string, clientUserId: string, status: ContractStatus) {
  const row = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId, clientUserId, packageName: "Seed", totalSessions: 10, price: 1_000_000, status },
  });
  createdIds.push(row.id);
}
dbTest.after(async () => {
  await prisma.contract.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});

const forbidden = (e: any) => e?.status === 403;

dbTest("PT may read the client's InBody history while the contract is ACTIVE", async () => {
  const pt = randomUUID();
  const client = randomUUID();
  await seed(pt, client, ContractStatus.ACTIVE);
  assert.deepEqual(await inbodyService.getClientHistory(pt, client), []);
});

dbTest("BR-32 as written: after the contract is COMPLETED the PT can STILL read the client's InBody history (no expiry)", async () => {
  const pt = randomUUID();
  const client = randomUUID();
  await seed(pt, client, ContractStatus.COMPLETED);
  assert.deepEqual(await inbodyService.getClientHistory(pt, client), []);
});

dbTest("no relationship, or a never-started / ended-badly contract: 403", async () => {
  const pt = randomUUID();
  const client = randomUUID();
  await assert.rejects(() => inbodyService.getClientHistory(pt, client), forbidden);
  for (const status of [ContractStatus.PENDING_REVIEW, ContractStatus.PENDING_SIGNATURE, ContractStatus.PENDING_PAYMENT, ContractStatus.CANCELLED, ContractStatus.REJECTED, ContractStatus.EXPIRED]) {
    const c = randomUUID();
    await seed(pt, c, status);
    await assert.rejects(() => inbodyService.getClientHistory(pt, c), forbidden, status);
  }
});
