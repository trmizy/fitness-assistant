/**
 * C2-05 - a contract ended by PT_CANCELLED (and by the other party-declared reasons) tells the people involved.
 *
 *   PT_CANCELLED        -> exactly one notice to the client (PT name + the amount the ledger credited) and one to the PT
 *   CLIENT_CANCELLED    -> exactly one notice to the PT, none to the client
 *   PT_REPEATED_NO_SHOW -> exactly one notice to the PT
 *   a replay of an ended contract sends nothing more; a notification failure never blocks / rolls back the ending.
 *
 * Evidence label: BACKEND INTEGRATION against the isolated *_test database (real locks, real SQL, real notification rows);
 * payment-service and the auth-service name lookup are TEST FIXTURE stand-ins. Run:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/contract-termination-notices.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { notificationService } from "../services/notification.service";
import { settleContractTermination } from "../services/contract-payout.service";
import { cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const notices = (contractId: string) => prisma.notification.findMany({ where: { entityId: contractId }, orderBy: { createdAt: "asc" } });

async function run(ledger: unknown, body: (c: Awaited<ReturnType<typeof makeContract>>, pt: string) => Promise<void>) {
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  const s = stubs(ledger, { realNotifications: true });
  const restoreName = patch(authServiceClient, "internalGet", async () => ({ status: 200, data: { user: { email: "pt@x.test", firstName: "Minh", lastName: "Trần" } } }));
  try {
    await body(c, pt);
  } finally {
    restoreName();
    s.restore();
    await cleanup([pt], [c.id]);
  }
}

test("PT_CANCELLED: exactly one notice to the client (name + credited amount, contract link) and one to the PT", { skip }, async () => {
  await run({ refund: "920000.00", paid: "920000.00" }, async (c, pt) => {
    const r = await settleContractTermination(c.id, "PT_CANCELLED", { cancelledBy: pt, cancellationReason: "bận" });
    assert.equal(r?.statusWritten, true);
    const rows = await notices(c.id);
    assert.equal(rows.length, 2);
    const client = rows.filter((n) => n.userId === c.clientUserId);
    const ptRows = rows.filter((n) => n.userId === pt);
    assert.equal(client.length, 1);
    assert.equal(ptRows.length, 1);
    assert.equal(client[0].text, 'Huấn luyện viên Minh Trần đã chấm dứt hợp đồng "Gói 10 buổi". Bạn được hoàn 920.000 ₫ vào ví, các buổi chưa tập đã được huỷ.');
    assert.equal(client[0].link, "/client/contracts");
    assert.equal(client[0].eventType, "CONTRACT_CANCELLED");
    assert.equal(ptRows[0].link, "/pt/contracts");
    assert.match(ptRows[0].text, /đã được chấm dứt/);

    // a replay of the already-ended contract (retry / sweep) sends nothing more
    const again = await settleContractTermination(c.id, "PT_CANCELLED");
    assert.equal(again?.statusWritten, false);
    assert.equal((await notices(c.id)).length, 2);
  });
});

test("PT_CANCELLED with no figure in the ledger answer: the client's notice carries no number", { skip }, async () => {
  await run({}, async (c, pt) => {
    await settleContractTermination(c.id, "PT_CANCELLED", { cancelledBy: pt });
    const client = (await notices(c.id)).filter((n) => n.userId === c.clientUserId);
    assert.equal(client.length, 1);
    assert.doesNotMatch(client[0].text, /₫/);
    assert.match(client[0].text, /huỷ/);
  });
});

test("CLIENT_CANCELLED: exactly one notice, to the PT only", { skip }, async () => {
  await run({ refund: "1000000.00" }, async (c) => {
    await settleContractTermination(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId });
    const rows = await notices(c.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, c.ptUserId);
    assert.equal(rows[0].link, "/pt/contracts");
  });
});

test("PT_REPEATED_NO_SHOW: exactly one notice, to the PT only", { skip }, async () => {
  await run({ refund: "1000000.00" }, async (c) => {
    await settleContractTermination(c.id, "PT_REPEATED_NO_SHOW", { cancelledBy: c.clientUserId });
    const rows = await notices(c.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, c.ptUserId);
  });
});

test("a failing notification never blocks or rolls back the ending", { skip }, async () => {
  await run({ refund: "920000.00", paid: "920000.00" }, async (c, pt) => {
    const restore = patch(notificationService, "create", async () => {
      throw new Error("notification store down");
    });
    try {
      const r = await settleContractTermination(c.id, "PT_CANCELLED", { cancelledBy: pt });
      assert.equal(r?.statusWritten, true);
    } finally {
      restore();
    }
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.terminationReason, "PT_CANCELLED");
    assert.notEqual(row.status, "ACTIVE");
  });
});
