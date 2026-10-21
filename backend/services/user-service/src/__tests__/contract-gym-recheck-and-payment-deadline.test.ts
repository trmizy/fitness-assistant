/**
 * Hợp đồng gắn phòng gym — hỏi lại gym-service lúc PT chấp nhận và lúc khách khởi tạo thanh toán;
 * và hạn thanh toán 12 giờ trong `pay`.
 *
 * Quyết định sản phẩm: chỉ hợp đồng ĐÃ TRẢ TIỀN mới là cam kết đã có. Hợp đồng chưa trả vẫn là
 * "mới": nếu trước khi trả gym không còn nhận hợp đồng mới (hoặc thoả thuận PT–gym bắt đầu bị
 * chấm dứt) thì không được đi tiếp.
 *
 * TEST FIXTURE — repository / gym-service / payment-service được thay bằng stub, không cần DB.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, ContractStatus } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { ptTermsService } from "../services/pt-terms.service";
import {
  contractService,
  computePaymentDueAt,
  CONTRACT_PAYMENT_DEADLINE_HOURS,
  CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES,
} from "../services/contract.service";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";
import { stubSessionSettlements } from "./session-settlement-memory.stub";

// pt-restriction.service reads the restriction tables directly: answer them like an empty database (no restriction) so this unit test needs no DB.
stubPtRestrictionReads();
// the money steps track their progress in session_settlements: keep that table in memory too (no DB writes from a unit test).
stubSessionSettlements();

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    ptUserId: "pt-1",
    clientUserId: "client-1",
    status: ContractStatus.PENDING_PAYMENT,
    price: new Prisma.Decimal("1000000"),
    packageName: "Gói 12 buổi",
    paymentTransactionId: null,
    gymId: "gym-1",
    platformRate: new Prisma.Decimal("0.1000"),
    ptRate: new Prisma.Decimal("0.7000"),
    gymRate: new Prisma.Decimal("0.2000"),
    paymentDueAt: new Date(Date.now() + 60 * 60 * 1000),
    // Codex #6: a gym contract carries a fixed duration (frozen from the package) and the brand its membership was checked at
    validityDays: 60,
    gymBrandId: "brand-1",
    ...overrides,
  };
}

const DAY = 24 * 60 * 60 * 1000;
/** gym-service's answer for the client's membership at the gym: unlimited by default (no end date), so the existing tests are unaffected. */
function membershipLookup(endDate: string | null = null) {
  return {
    hasActiveMembership: true,
    brandId: "brand-1",
    membership: { membershipId: "mem-1", planName: "Plan", purchaseGymId: "gym-1", startDate: null, endDate },
  };
}

const MATCHING = { collaborationId: "col-1", platformRate: "0.1", ptRate: "0.70", gymRate: "0.2" };

/** Stub the world; returns call counters and a restore fn. */
function world(opts: {
  contract: Record<string, unknown>;
  collab?: unknown; // object | null | "UNAVAILABLE"
  membership?: unknown; // lookup object | null | "UNAVAILABLE" (default: an unlimited active membership)
}) {
  const calls = { gym: 0, membership: 0, checkout: 0, claim: 0, extend: [] as Date[] };
  const restores = [
    patch(contractRepository, "findById", async () => opts.contract as any),
    patch(contractRepository, "updateWhereStatus", async () => {
      calls.claim++;
      return { count: 1 };
    }),
    patch(gymClient, "getActiveCollaboration", async () => {
      calls.gym++;
      if (opts.collab === "UNAVAILABLE") throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      return opts.collab as any;
    }),
    patch(gymClient, "getClientMembershipAtGym", async () => {
      calls.membership++;
      if (opts.membership === "UNAVAILABLE") throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      return (opts.membership === undefined ? membershipLookup() : opts.membership) as any;
    }),
    patch(paymentClient, "checkout", async () => {
      calls.checkout++;
      return { redirectUrl: "https://gateway.example/pay" };
    }),
    patch(contractRepository, "extendPaymentDueAt", async (_id: string, to: Date) => {
      calls.extend.push(to);
      return { count: 1 };
    }),
    // D25 gate: this suite is about the gym gate, so the PT is stubbed as having confirmed the current PT terms (the gate itself is tested in pt-terms-acceptance.integration.test.ts).
    patch(ptTermsService, "assertAcceptedCurrent", async () => undefined),
    // accept: stop right after the gym gate — no real auth-service / PDF in a stubbed test.
    // (a 404 = "auth-service has no such user": the flow ends in 500 account-not-found. An outage would now be 503, fail-closed.)
    patch(authServiceClient, "internalGet", async () => {
      throw Object.assign(new Error("no such user in this test"), { response: { status: 404, data: {} } });
    }),
  ];
  return { calls, restore: () => restores.reverse().forEach((r) => r()) };
}

// ─────────────────────────────── pay: Rule 1 ───────────────────────────────

test("pay: gym no longer has an agreement -> 409 GYM_NOT_ACCEPTING_CONTRACTS, no checkout, status untouched", async () => {
  const w = world({ contract: contractRow(), collab: null });
  try {
    await assert.rejects(
      () => contractService.pay("c1", "client-1"),
      (e: any) => {
        assert.equal(e.status, 409);
        assert.equal(e.code, "GYM_NOT_ACCEPTING_CONTRACTS");
        assert.match(e.message, /không còn nhận hợp đồng PT mới/);
        return true;
      },
    );
    assert.equal(w.calls.gym, 1);
    assert.equal(w.calls.checkout, 0, "no money may move");
    assert.equal(w.calls.claim, 0);
  } finally {
    w.restore();
  }
});

test("pay: gym-service unreachable -> 503, no checkout (neither eligible nor ineligible)", async () => {
  const w = world({ contract: contractRow(), collab: "UNAVAILABLE" });
  try {
    await assert.rejects(
      () => contractService.pay("c1", "client-1"),
      (e: any) => e.status === 503 && e.code === undefined,
    );
    assert.equal(w.calls.checkout, 0);
  } finally {
    w.restore();
  }
});

test("pay: agreement returned but a rate differs from the snapshot -> 409 GYM_TERMS_CHANGED, no checkout", async () => {
  for (const changed of [
    { ...MATCHING, platformRate: "0.15" },
    { ...MATCHING, ptRate: "0.65" },
    { ...MATCHING, gymRate: "0.25" },
  ]) {
    const w = world({ contract: contractRow(), collab: changed });
    try {
      await assert.rejects(
        () => contractService.pay("c1", "client-1"),
        (e: any) => e.status === 409 && e.code === "GYM_TERMS_CHANGED",
      );
      assert.equal(w.calls.checkout, 0);
    } finally {
      w.restore();
    }
  }
});

test("pay: rates equal as decimals ('0.1' vs 0.1000, '0.70' vs 0.7000) pass the gate and checkout proceeds", async () => {
  const w = world({ contract: contractRow(), collab: MATCHING });
  try {
    const out: any = await contractService.pay("c1", "client-1");
    assert.equal(w.calls.gym, 1);
    assert.equal(w.calls.checkout, 1);
    assert.ok(out.payment);
  } finally {
    w.restore();
  }
});

test("pay: contract WITHOUT gymId never calls gym-service", async () => {
  const w = world({
    contract: contractRow({ gymId: null, platformRate: new Prisma.Decimal("0.10"), ptRate: new Prisma.Decimal("0.90"), gymRate: new Prisma.Decimal("0") }),
    collab: null, // would be fatal if consulted
  });
  try {
    await contractService.pay("c1", "client-1");
    assert.equal(w.calls.gym, 0, "independent / online / marketplace contracts must not touch gym-service");
    assert.equal(w.calls.checkout, 1);
  } finally {
    w.restore();
  }
});

// ─────────────────────────────── pay: Rule 2 ───────────────────────────────

test("pay: past paymentDueAt -> 409 PAYMENT_DEADLINE_PASSED even though the sweep has not run; no gym call, no checkout", async () => {
  const w = world({
    contract: contractRow({ paymentDueAt: new Date(Date.now() - 1000) }),
    collab: MATCHING,
  });
  try {
    await assert.rejects(
      () => contractService.pay("c1", "client-1"),
      (e: any) => e.status === 409 && e.code === "PAYMENT_DEADLINE_PASSED",
    );
    assert.equal(w.calls.gym, 0);
    assert.equal(w.calls.checkout, 0);
  } finally {
    w.restore();
  }
});

test("pay: no paymentDueAt (legacy row) is not refused by the deadline check", async () => {
  const w = world({ contract: contractRow({ paymentDueAt: null, gymId: null }), collab: null });
  try {
    await contractService.pay("c1", "client-1");
    assert.equal(w.calls.checkout, 1);
  } finally {
    w.restore();
  }
});

// ─────────────────────── pay: extend the deadline once a checkout is open ───────────────────────

test("pay: checkout started -> paymentDueAt extended to ~now + grace (default 60 min); same for a contract with NO gym", async () => {
  assert.equal(CONTRACT_PAYMENT_CHECKOUT_GRACE_MINUTES, 60);
  for (const gymId of ["gym-1", null]) {
    const w = world({ contract: contractRow({ gymId, paymentDueAt: new Date(Date.now() + 60 * 1000) }), collab: MATCHING });
    try {
      const before = Date.now();
      await contractService.pay("c1", "client-1");
      assert.equal(w.calls.checkout, 1);
      assert.equal(w.calls.extend.length, 1);
      const t = w.calls.extend[0].getTime();
      assert.ok(t >= before + 60 * 60 * 1000 && t <= Date.now() + 60 * 60 * 1000, "target = now + 60 min");
    } finally {
      w.restore();
    }
  }
});

test("pay: failed checkout creation -> deadline NOT extended", async () => {
  const w = world({ contract: contractRow({ gymId: null }) });
  const restore = patch(paymentClient, "checkout", async () => {
    throw new Error("gateway down");
  });
  try {
    await assert.rejects(() => contractService.pay("c1", "client-1"), /gateway down/);
    assert.equal(w.calls.extend.length, 0);
  } finally {
    restore();
    w.restore();
  }
});

test("pay: extension update throwing does not fail the payment request (checkout result still returned)", async () => {
  const w = world({ contract: contractRow({ gymId: null }) });
  const restore = patch(contractRepository, "extendPaymentDueAt", async () => {
    throw new Error("db blip");
  });
  try {
    const out: any = await contractService.pay("c1", "client-1");
    assert.equal(out.payment.redirectUrl, "https://gateway.example/pay");
  } finally {
    restore();
    w.restore();
  }
});

test("pay: legacy row with no paymentDueAt never gets a deadline invented by the extension", async () => {
  const w = world({ contract: contractRow({ paymentDueAt: null, gymId: null }) });
  try {
    await contractService.pay("c1", "client-1");
    assert.equal(w.calls.checkout, 1);
    assert.equal(w.calls.extend.length, 0);
  } finally {
    w.restore();
  }
});

test("computePaymentDueAt = from + CONTRACT_PAYMENT_DEADLINE_HOURS (default 12h)", () => {
  assert.equal(CONTRACT_PAYMENT_DEADLINE_HOURS, 12);
  const from = new Date("2026-10-10T00:00:00.000Z");
  assert.equal(computePaymentDueAt(from).toISOString(), "2026-10-10T12:00:00.000Z");
});

// ─────────────────────────────── accept: Rule 1 ───────────────────────────────

function pendingReview(overrides: Record<string, unknown> = {}) {
  return contractRow({ status: ContractStatus.PENDING_REVIEW, paymentDueAt: null, ...overrides });
}

test("accept: gym no longer has an agreement -> 409 GYM_NOT_ACCEPTING_CONTRACTS, contract not claimed", async () => {
  const w = world({ contract: pendingReview(), collab: null });
  try {
    await assert.rejects(
      () => contractService.acceptContract("c1", "pt-1"),
      (e: any) => e.status === 409 && e.code === "GYM_NOT_ACCEPTING_CONTRACTS",
    );
    assert.equal(w.calls.claim, 0, "status must stay PENDING_REVIEW");
  } finally {
    w.restore();
  }
});

test("accept: gym-service unreachable -> 503, contract not claimed", async () => {
  const w = world({ contract: pendingReview(), collab: "UNAVAILABLE" });
  try {
    await assert.rejects(
      () => contractService.acceptContract("c1", "pt-1"),
      (e: any) => e.status === 503,
    );
    assert.equal(w.calls.claim, 0);
  } finally {
    w.restore();
  }
});

test("accept: terms changed since the request -> 409 GYM_TERMS_CHANGED, contract not claimed", async () => {
  const w = world({ contract: pendingReview(), collab: { ...MATCHING, gymRate: "0.30" } });
  try {
    await assert.rejects(
      () => contractService.acceptContract("c1", "pt-1"),
      (e: any) => e.status === 409 && e.code === "GYM_TERMS_CHANGED",
    );
    assert.equal(w.calls.claim, 0);
  } finally {
    w.restore();
  }
});

test("accept: matching agreement passes the gym gate (flow then stops at the stubbed auth lookup, before the claim)", async () => {
  const w = world({ contract: pendingReview(), collab: MATCHING });
  try {
    await assert.rejects(
      () => contractService.acceptContract("c1", "pt-1"),
      (e: any) => e.status === 500 && /email unavailable|not found/.test(e.message),
    );
    assert.equal(w.calls.gym, 1);
  } finally {
    w.restore();
  }
});

test("accept: contract WITHOUT gymId never calls gym-service", async () => {
  const w = world({ contract: pendingReview({ gymId: null }), collab: null });
  try {
    await assert.rejects(
      () => contractService.acceptContract("c1", "pt-1"),
      (e: any) => e.status === 500, // stubbed auth lookup, i.e. it got PAST the gym step
    );
    assert.equal(w.calls.gym, 0);
  } finally {
    w.restore();
  }
});

// ─────────────────────── Codex #6: fixed duration + membership coverage, re-asked at accept and pay ───────────────────────

test("pay: a gym contract with NO fixed duration (legacy open-ended row) -> 409 GYM_CONTRACT_REQUIRES_FIXED_DURATION before any membership lookup or checkout", async () => {
  for (const validityDays of [null, 0]) {
    const w = world({ contract: contractRow({ validityDays }), collab: MATCHING });
    try {
      await assert.rejects(
        () => contractService.pay("c1", "client-1"),
        (e: any) => e.status === 409 && e.code === "GYM_CONTRACT_REQUIRES_FIXED_DURATION" && /thời hạn cố định/.test(e.message) && !/Học viên/.test(e.message),
        String(validityDays),
      );
      assert.equal(w.calls.membership, 0, "the verdict does not depend on the membership");
      assert.equal(w.calls.checkout, 0, "no money may move");
    } finally {
      w.restore();
    }
  }
});

test("pay: the membership ended / was cancelled since the request -> 422 MEMBERSHIP_REQUIRED, no checkout", async () => {
  const w = world({ contract: contractRow(), collab: MATCHING, membership: { hasActiveMembership: false, brandId: "brand-1", membership: null } });
  try {
    await assert.rejects(() => contractService.pay("c1", "client-1"), (e: any) => e.status === 422 && e.code === "MEMBERSHIP_REQUIRED");
    assert.equal(w.calls.checkout, 0);
  } finally {
    w.restore();
  }
});

test("pay: the membership ends before the contract would (10 days left vs 60) -> 422 MEMBERSHIP_DOES_NOT_COVER_CONTRACT, no checkout; enough days -> checkout proceeds", async () => {
  const short = world({ contract: contractRow(), collab: MATCHING, membership: membershipLookup(new Date(Date.now() + 10 * DAY).toISOString()) });
  try {
    await assert.rejects(
      () => contractService.pay("c1", "client-1"),
      (e: any) => e.status === 422 && e.code === "MEMBERSHIP_DOES_NOT_COVER_CONTRACT" && !/Học viên/.test(e.message),
    );
    assert.equal(short.calls.checkout, 0);
  } finally {
    short.restore();
  }
  const enough = world({ contract: contractRow(), collab: MATCHING, membership: membershipLookup(new Date(Date.now() + 61 * DAY).toISOString()) });
  try {
    await contractService.pay("c1", "client-1");
    assert.equal(enough.calls.checkout, 1);
  } finally {
    enough.restore();
  }
});

test("pay: an UNLIMITED membership (no end date) covers the fixed-duration contract; gym-service membership lookup down -> 503, no checkout", async () => {
  const ok = world({ contract: contractRow(), collab: MATCHING });
  try {
    await contractService.pay("c1", "client-1");
    assert.equal(ok.calls.membership, 1);
    assert.equal(ok.calls.checkout, 1);
  } finally {
    ok.restore();
  }
  const down = world({ contract: contractRow(), collab: MATCHING, membership: "UNAVAILABLE" });
  try {
    await assert.rejects(() => contractService.pay("c1", "client-1"), (e: any) => e.status === 503 && e.code === undefined);
    assert.equal(down.calls.checkout, 0);
  } finally {
    down.restore();
  }
});

test("pay: a contract WITHOUT a gym never asks about a membership, even with validityDays null (non-gym contracts unchanged)", async () => {
  const w = world({ contract: contractRow({ gymId: null, gymBrandId: null, validityDays: null }), collab: null });
  try {
    await contractService.pay("c1", "client-1");
    assert.equal(w.calls.gym, 0);
    assert.equal(w.calls.membership, 0);
    assert.equal(w.calls.checkout, 1);
  } finally {
    w.restore();
  }
});

test("accept: a gym contract with NO fixed duration -> 409 GYM_CONTRACT_REQUIRES_FIXED_DURATION worded for the PT, contract not claimed", async () => {
  const w = world({ contract: pendingReview({ validityDays: null }), collab: MATCHING });
  try {
    await assert.rejects(
      () => contractService.acceptContract("c1", "pt-1"),
      (e: any) => e.status === 409 && e.code === "GYM_CONTRACT_REQUIRES_FIXED_DURATION" && /từ chối yêu cầu/.test(e.message),
    );
    assert.equal(w.calls.claim, 0, "status must stay PENDING_REVIEW");
    assert.equal(w.calls.membership, 0);
  } finally {
    w.restore();
  }
});

test("accept: the client's membership is gone / too short -> 422 (worded for the PT), contract not claimed; covered -> passes the gate", async () => {
  const gone = world({ contract: pendingReview(), collab: MATCHING, membership: { hasActiveMembership: false, brandId: "brand-1", membership: null } });
  try {
    await assert.rejects(
      () => contractService.acceptContract("c1", "pt-1"),
      (e: any) => e.status === 422 && e.code === "MEMBERSHIP_REQUIRED" && /Học viên/.test(e.message),
    );
    assert.equal(gone.calls.claim, 0);
  } finally {
    gone.restore();
  }
  const short = world({ contract: pendingReview(), collab: MATCHING, membership: membershipLookup(new Date(Date.now() + 5 * DAY).toISOString()) });
  try {
    await assert.rejects(() => contractService.acceptContract("c1", "pt-1"), (e: any) => e.status === 422 && e.code === "MEMBERSHIP_DOES_NOT_COVER_CONTRACT");
    assert.equal(short.calls.claim, 0);
  } finally {
    short.restore();
  }
  const covered = world({ contract: pendingReview(), collab: MATCHING });
  try {
    await assert.rejects(() => contractService.acceptContract("c1", "pt-1"), (e: any) => e.status === 500); // stops at the stubbed auth lookup, i.e. PAST the gym gates
    assert.equal(covered.calls.membership, 1);
  } finally {
    covered.restore();
  }
});

test("accept: a contract WITHOUT a gym never asks about a membership", async () => {
  const w = world({ contract: pendingReview({ gymId: null, gymBrandId: null, validityDays: null }), collab: null });
  try {
    await assert.rejects(() => contractService.acceptContract("c1", "pt-1"), (e: any) => e.status === 500);
    assert.equal(w.calls.membership, 0);
  } finally {
    w.restore();
  }
});
