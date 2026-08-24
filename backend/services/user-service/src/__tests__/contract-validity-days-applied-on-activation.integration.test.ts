import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";

/**
 * Money-flow redesign plan item 3.6 — "thời hạn sử dụng gói không được áp vào hợp đồng".
 *
 * `validityDays` existed on `PTServicePackage` but nothing ever read it when a contract
 * activated — a package sold as "12 sessions, use within 90 days" produced a contract with no
 * end date at all. Fixed in `activateIfPending`, which is where `startDate` (the real clock
 * start — payment, not signing) is already set.
 *
 * Integration test (real dev DB) — a direct Prisma repository method, simplest verified for
 * real rather than re-asserting its own mocked configuration.
 */

async function makePendingContract(overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: randomUUID(),
      clientUserId: randomUUID(),
      packageName: "Test Package",
      totalSessions: 12,
      status: "PENDING_PAYMENT",
      ...overrides,
    },
  });
}

test("activating a contract with a validityDays snapshot sets endDate from it", async () => {
  const contract = await makePendingContract({ validityDays: 90 });

  try {
    const before = Date.now();
    const activated = await contractRepository.activateIfPending(contract.id, "txn-1");
    const after = Date.now();

    assert.ok(activated);
    assert.equal(activated!.status, "ACTIVE");
    assert.ok(activated!.endDate, "endDate must be set when the package declared a validity window");

    const expectedMs = 90 * 24 * 60 * 60 * 1000;
    const actualMs = activated!.endDate!.getTime() - activated!.startDate!.getTime();
    // Allow a small tolerance for the few ms the test itself takes to run.
    assert.ok(Math.abs(actualMs - expectedMs) < 5000, `endDate should be ~90 days after startDate, got ${actualMs}ms`);
    assert.ok(activated!.startDate!.getTime() >= before && activated!.startDate!.getTime() <= after);
  } finally {
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("activating a contract with NO validityDays snapshot leaves endDate null — unchanged behavior", async () => {
  const contract = await makePendingContract({ validityDays: null });

  try {
    const activated = await contractRepository.activateIfPending(contract.id, "txn-1");
    assert.ok(activated);
    assert.equal(activated!.status, "ACTIVE");
    assert.equal(activated!.endDate, null);
  } finally {
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("activating twice (a webhook retry) is a no-op the second time — does not shift endDate", async () => {
  const contract = await makePendingContract({ validityDays: 30 });

  try {
    const first = await contractRepository.activateIfPending(contract.id, "txn-1");
    // A moment later, a retry delivers the same webhook again.
    const second = await contractRepository.activateIfPending(contract.id, "txn-1");

    assert.equal(second!.endDate!.getTime(), first!.endDate!.getTime(), "a retry must not recompute (and drift) endDate");
  } finally {
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});
