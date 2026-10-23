/**
 * Phase 3 / P3.6 logic: reason codes -> Vietnamese copy, the OPTIONAL per-branch `eligibility`, the
 * 422 refusal, and the checkout-context summary. Shapes mirror the user-service responses of
 * `GET /contracts/gym-options` (P3.4 + P3.3) and `GET /contracts/:id/checkout-context` (P3.5).
 *
 * Runs with: npx tsx --test src/features/__tests__/contractGymOptions.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEADLINE_PASSED_COPY,
  ELIGIBILITY_UNKNOWN_BLOCK_COPY,
  MEMBERSHIP_DOES_NOT_COVER_COPY,
  MEMBERSHIP_REQUIRED_COPY,
  PT_RECHECK_COPY,
  checkoutWarnings,
  eligibilityCopy,
  formatDateVi,
  gymsReasonCopy,
  membershipLabel,
  normalizeCheckoutContext,
  normalizeGymOptions,
  pickableGym,
  readEligibility,
  readEligibilityRefusal,
  requestBlockedCopy,
} from "../services/contractGymOptions";

const gymRow = (over: Record<string, unknown> = {}) => ({
  gymId: "g1",
  name: "Gym Quận 1",
  city: "TP.HCM",
  brandId: "b1",
  isPtTrainingLocation: true,
  membership: {
    hasActiveMembership: false,
    membershipId: null,
    planName: null,
    endDate: null,
    purchasedHere: false,
  },
  ...over,
});

const options = (gyms: unknown[], over: Record<string, unknown> = {}) => ({
  ptUserId: "pt1",
  packageId: "p1",
  sessionMode: "OFFLINE",
  pt: { referralCode: "QGT7KPJW" },
  requestBlockedReason: null,
  gymsReason: null,
  gyms,
  ...over,
});

describe("reason code -> copy", () => {
  it("maps the two eligibility reasons to the agreed Vietnamese sentences", () => {
    assert.equal(
      eligibilityCopy("MEMBERSHIP_REQUIRED"),
      "Bạn cần có gói hội viên còn hiệu lực tại phòng tập này để đăng ký với PT.",
    );
    assert.equal(
      eligibilityCopy("MEMBERSHIP_DOES_NOT_COVER_CONTRACT"),
      "Gói hội viên hiện tại không đủ thời hạn cho hợp đồng PT này.",
    );
    assert.equal(eligibilityCopy("SOMETHING_NEW"), null);
    assert.equal(eligibilityCopy(null), null);
  });

  it("maps the request-blocked codes and falls back for an unknown one", () => {
    assert.match(requestBlockedCopy("ACTIVE_CONTRACT_EXISTS") ?? "", /đang có hợp đồng/);
    assert.match(requestBlockedCopy("PT_NOT_ACCEPTING_CLIENTS") ?? "", /không nhận khách mới/);
    assert.match(requestBlockedCopy("PT_TEMPORARILY_UNAVAILABLE") ?? "", /tạm ngưng/);
    assert.match(requestBlockedCopy("PT_ACCOUNT_LOCKED") ?? "", /không nhận khách mới/);
    assert.match(requestBlockedCopy("FUTURE_CODE") ?? "", /chưa thể gửi yêu cầu/);
    assert.equal(requestBlockedCopy(null), null);
  });

  it("never leaks a raw internal code into client-facing copy", () => {
    const all = [
      requestBlockedCopy("PT_TEMPORARILY_UNAVAILABLE"),
      requestBlockedCopy("PT_ACCOUNT_LOCKED"),
      requestBlockedCopy("PT_NOT_ACCEPTING_CLIENTS"),
      requestBlockedCopy("ACTIVE_CONTRACT_EXISTS"),
      requestBlockedCopy("X_UNKNOWN"),
      gymsReasonCopy("ONLINE_PACKAGE"),
      gymsReasonCopy("NO_GYM_AGREEMENT"),
      MEMBERSHIP_REQUIRED_COPY,
      MEMBERSHIP_DOES_NOT_COVER_COPY,
      ELIGIBILITY_UNKNOWN_BLOCK_COPY,
    ];
    for (const text of all) assert.doesNotMatch(String(text), /[A-Z]{3,}_[A-Z_]+/);
  });

  it("gymsReason: online and no-agreement have copy, REQUEST_BLOCKED does not (the blocked reason speaks)", () => {
    assert.match(gymsReasonCopy("ONLINE_PACKAGE") ?? "", /Gói online/);
    assert.match(gymsReasonCopy("NO_GYM_AGREEMENT") ?? "", /chưa có phòng gym/);
    assert.equal(gymsReasonCopy("REQUEST_BLOCKED"), null);
    assert.equal(gymsReasonCopy(null), null);
  });
});

describe("readEligibility (optional field)", () => {
  it("absent field = no information, NOT blocked", () => {
    assert.deepEqual(readEligibility(gymRow()), { known: false, canRequest: true, reason: null });
  });

  it("garbage field = no information, NOT blocked", () => {
    for (const bad of ["no", 3, [], true]) {
      assert.deepEqual(readEligibility({ eligibility: bad }), {
        known: false,
        canRequest: true,
        reason: null,
      });
    }
  });

  it("canRequest true is allowed", () => {
    assert.deepEqual(readEligibility({ eligibility: { canRequest: true, reason: null } }), {
      known: true,
      canRequest: true,
      reason: null,
    });
  });

  it("canRequest false with a known reason blocks and keeps the reason", () => {
    assert.deepEqual(
      readEligibility({ eligibility: { canRequest: false, reason: "MEMBERSHIP_REQUIRED" } }),
      { known: true, canRequest: false, reason: "MEMBERSHIP_REQUIRED" },
    );
  });

  it("canRequest false with an unknown reason still blocks (generic copy)", () => {
    const e = readEligibility({ eligibility: { canRequest: false, reason: "NEW_RULE" } });
    assert.equal(e.canRequest, false);
    assert.equal(e.reason, null);
  });

  it("a known reason without canRequest blocks; reason with canRequest true does not", () => {
    assert.equal(readEligibility({ eligibility: { reason: "MEMBERSHIP_REQUIRED" } }).canRequest, false);
    assert.equal(
      readEligibility({ eligibility: { canRequest: true, reason: "MEMBERSHIP_REQUIRED" } }).canRequest,
      true,
    );
  });
});

describe("normalizeGymOptions", () => {
  it("keeps the server order and works with no eligibility field at all", () => {
    const view = normalizeGymOptions(
      options([gymRow({ gymId: "a", name: "A" }), gymRow({ gymId: "b", name: "B", isPtTrainingLocation: false })]),
    );
    assert.deepEqual(view.gyms.map((g) => g.gymId), ["a", "b"]);
    assert.ok(view.gyms.every((g) => g.selectable && g.blockedCopy === null));
    assert.equal(view.ptReferralCode, "QGT7KPJW");
  });

  it("blocks a branch with MEMBERSHIP_REQUIRED, with copy and a purchase offer", () => {
    const view = normalizeGymOptions(
      options([gymRow({ eligibility: { canRequest: false, reason: "MEMBERSHIP_REQUIRED" } })]),
    );
    const [g] = view.gyms;
    assert.equal(g.selectable, false);
    assert.equal(g.blockedCopy, MEMBERSHIP_REQUIRED_COPY);
    assert.equal(g.offersMembershipPurchase, true);
  });

  it("blocks MEMBERSHIP_DOES_NOT_COVER_CONTRACT with its copy and NO purchase offer", () => {
    const view = normalizeGymOptions(
      options([
        gymRow({
          membership: { hasActiveMembership: true, endDate: "2026-12-20T12:00:00.000Z", planName: "Tháng" },
          eligibility: { canRequest: false, reason: "MEMBERSHIP_DOES_NOT_COVER_CONTRACT" },
        }),
      ]),
    );
    const [g] = view.gyms;
    assert.equal(g.selectable, false);
    assert.equal(g.blockedCopy, MEMBERSHIP_DOES_NOT_COVER_COPY);
    assert.equal(g.offersMembershipPurchase, false);
  });

  it("an eligible branch stays selectable", () => {
    const [g] = normalizeGymOptions(
      options([gymRow({ eligibility: { canRequest: true, reason: null } })]),
    ).gyms;
    assert.equal(g.selectable, true);
    assert.equal(g.offersMembershipPurchase, false);
  });

  it("surfaces requestBlockedReason and gymsReason in plain words", () => {
    const view = normalizeGymOptions(
      options([], { requestBlockedReason: "ACTIVE_CONTRACT_EXISTS", gymsReason: "REQUEST_BLOCKED" }),
    );
    assert.equal(view.requestBlockedCode, "ACTIVE_CONTRACT_EXISTS");
    assert.match(view.requestBlockedCopy ?? "", /đang có hợp đồng/);
    assert.equal(view.gymsReasonCopy, null);
    const online = normalizeGymOptions(options([], { sessionMode: "ONLINE", gymsReason: "ONLINE_PACKAGE" }));
    assert.match(online.gymsReasonCopy ?? "", /Gói online/);
    const none = normalizeGymOptions(options([], { gymsReason: "NO_GYM_AGREEMENT" }));
    assert.match(none.gymsReasonCopy ?? "", /chưa có phòng gym/);
  });

  it("tolerates junk: no gyms array, no referral code, rows without an id", () => {
    const view = normalizeGymOptions({ gyms: [{ name: "no id" }], pt: {} });
    assert.deepEqual(view.gyms, []);
    assert.equal(view.ptReferralCode, null);
    assert.equal(normalizeGymOptions(null).gyms.length, 0);
  });

  it("never exposes a revenue rate or an agreement id on a branch", () => {
    const [g] = normalizeGymOptions(
      options([gymRow({ ptRate: "0.55", gymRate: "0.35", agreementId: "ag1" })]),
    ).gyms;
    assert.equal(JSON.stringify(g).includes("0.55"), false);
    assert.equal(JSON.stringify(g).includes("ag1"), false);
  });
});

describe("membership status line", () => {
  it("none / active with date / active without date", () => {
    assert.equal(
      membershipLabel({ hasActiveMembership: false, planName: null, endDate: null }),
      "Chưa có gói hội viên",
    );
    assert.equal(
      membershipLabel({ hasActiveMembership: true, planName: "Tháng", endDate: "2026-12-20T12:00:00.000Z" }),
      "Đang có gói hội viên · hết hạn 20/12/2026",
    );
    assert.equal(
      membershipLabel({ hasActiveMembership: true, planName: null, endDate: null }),
      "Đang có gói hội viên",
    );
  });

  it("formatDateVi is empty for junk", () => {
    assert.equal(formatDateVi("not a date"), "");
    assert.equal(formatDateVi(null), "");
  });
});

describe("pickableGym", () => {
  const view = normalizeGymOptions(
    options([
      gymRow({ gymId: "ok" }),
      gymRow({ gymId: "no", eligibility: { canRequest: false, reason: "MEMBERSHIP_REQUIRED" } }),
    ]),
  );
  it("returns an eligible pick, drops a blocked or unknown one", () => {
    assert.equal(pickableGym(view, "ok")?.gymId, "ok");
    assert.equal(pickableGym(view, "no"), null);
    assert.equal(pickableGym(view, "gone"), null);
    assert.equal(pickableGym(view, null), null);
    assert.equal(pickableGym(null, "ok"), null);
  });
});

describe("422 from POST /contracts/request", () => {
  const e422 = (data: unknown) => ({ response: { status: 422, data } });

  it("recognises both codes in the places the backend puts them", () => {
    assert.equal(
      readEligibilityRefusal(e422({ code: "MEMBERSHIP_REQUIRED", error: "x" }))?.message,
      MEMBERSHIP_REQUIRED_COPY,
    );
    assert.equal(
      readEligibilityRefusal(e422({ error: "MEMBERSHIP_DOES_NOT_COVER_CONTRACT" }))?.message,
      MEMBERSHIP_DOES_NOT_COVER_COPY,
    );
    assert.equal(
      readEligibilityRefusal(e422({ error: { code: "MEMBERSHIP_REQUIRED" } }))?.reason,
      "MEMBERSHIP_REQUIRED",
    );
  });

  it("uses our own copy, not the server's message text", () => {
    const r = readEligibilityRefusal(
      e422({ code: "MEMBERSHIP_REQUIRED", error: "Client has no membership at brand b1", details: { gymId: "g1" } }),
    );
    assert.equal(r?.message, MEMBERSHIP_REQUIRED_COPY);
  });

  it("ignores other statuses and other 422s", () => {
    assert.equal(readEligibilityRefusal({ response: { status: 409, data: { code: "MEMBERSHIP_REQUIRED" } } }), null);
    assert.equal(readEligibilityRefusal(e422({ code: "PACKAGE_DISCONTINUED" })), null);
    assert.equal(readEligibilityRefusal(null), null);
    assert.equal(readEligibilityRefusal(e422(null)), null);
  });
});

describe("checkout context", () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    contractId: "c1",
    status: "PENDING_PAYMENT",
    package: { name: "Gói 12 buổi", totalSessions: 12, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 60 },
    amount: 3600000,
    rates: { platformRate: "0.10", ptRate: "0.55", gymRate: "0.35" },
    parties: { ptUserId: "pt1", gymId: "g1", clientUserId: "u1" },
    source: "DIRECT",
    gym: { gymId: "g1", brandId: "b1", agreementId: "ag1", agreementScope: "BRAND" },
    membership: { membershipId: null },
    payment: { paymentDueAt: "2026-10-18T07:30:00.000Z", hasPaymentTransaction: false },
    recheck: { ptAcceptsNewBusiness: true, paymentDeadlinePassed: false, gym: "OK" },
    ...over,
  });

  it("shows the server's amount and package; drops rates and internal ids from the summary", () => {
    const s = normalizeCheckoutContext(ctx());
    assert.equal(s?.amount, 3600000);
    assert.equal(s?.packageName, "Gói 12 buổi");
    assert.equal(s?.totalSessions, 12);
    assert.equal(s?.gymId, "g1"); // only to look the name up
    assert.deepEqual(s?.warnings, []);
    const keys = Object.keys(s ?? {});
    assert.equal(keys.includes("rates"), false);
    assert.equal(JSON.stringify(s).includes("0.55"), false);
    assert.equal(JSON.stringify(s).includes("ag1"), false);
  });

  it("formats the payment deadline from the server timestamp", () => {
    const s = normalizeCheckoutContext(ctx());
    assert.match(s?.paymentDueLabel ?? "", /^\d{2}:\d{2} 1[78]\/10\/2026$/);
    assert.equal(normalizeCheckoutContext(ctx({ payment: { paymentDueAt: null } }))?.paymentDueLabel, null);
  });

  it("an independent contract has no gym", () => {
    const s = normalizeCheckoutContext(
      ctx({ gym: { gymId: null }, parties: { gymId: null }, recheck: { ptAcceptsNewBusiness: true, paymentDeadlinePassed: false, gym: "NOT_APPLICABLE" } }),
    );
    assert.equal(s?.gymId, null);
    assert.deepEqual(s?.warnings, []);
  });

  it("turns each recheck problem into one plain sentence", () => {
    assert.deepEqual(
      checkoutWarnings({ ptAcceptsNewBusiness: { blockedCode: "PT_ACCOUNT_LOCKED" }, paymentDeadlinePassed: true, gym: "GYM_TERMS_CHANGED" }).length,
      3,
    );
    assert.deepEqual(checkoutWarnings({ ptAcceptsNewBusiness: { blockedCode: "X" } }), [PT_RECHECK_COPY]);
    assert.deepEqual(checkoutWarnings({ paymentDeadlinePassed: true }), [DEADLINE_PASSED_COPY]);
    assert.match(checkoutWarnings({ gym: "GYM_NOT_ACCEPTING_CONTRACTS" })[0], /không nhận hợp đồng mới/);
    assert.match(checkoutWarnings({ gym: "UNKNOWN" })[0], /Chưa kiểm tra được/);
    assert.deepEqual(checkoutWarnings({ gym: "OK" }), []);
    assert.deepEqual(checkoutWarnings(undefined), []);
    for (const w of checkoutWarnings({ ptAcceptsNewBusiness: { blockedCode: "PT_ACCOUNT_LOCKED" }, gym: "GYM_TERMS_CHANGED" })) {
      assert.doesNotMatch(w, /[A-Z]{3,}_[A-Z_]+/);
    }
  });

  it("returns null for an empty body and tolerates a missing amount", () => {
    assert.equal(normalizeCheckoutContext(null), null);
    assert.equal(normalizeCheckoutContext(ctx({ amount: undefined }))?.amount, null);
  });
});
