/** Nhóm C (gym phía tiền) integration fixes, 07/11 - INT-22. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeMoney } from "../complaints/gymCaseModel";
describe("INT-22 gym money amounts are grouped VND, never raw decimals", () => {
  it("formats posted amount and the server label", () => {
    const m = describeMoney({ derived: true, state: "LEDGER_POSTED_FULL", label: "Đã ghi vào ví Gymini: 200000.00", postedToMemberWallet: "200000.00", memberShortfall: null, referralClawbackShortfall: null } as never);
    assert.match(m.posted ?? "", /^200\.000\s₫$/u);
    assert.doesNotMatch(m.sentence, /200000\.00/);
    assert.match(m.sentence, /200\.000\s₫/u);
  });
  it("formats a shortfall and leaves null amounts null", () => {
    const m = describeMoney({ derived: true, state: "NEEDS_RECONCILIATION", label: "Chưa trả được khoản hoàn 100000.00", postedToMemberWallet: null, memberShortfall: "100000.00", referralClawbackShortfall: null } as never);
    assert.match(m.shortfall ?? "", /^100\.000\s₫$/u);
    assert.equal(m.posted, null);
    assert.match(m.sentence, /100\.000\s₫/u);
  });
});

describe("NO_MONEY_EFFECT chip follows the server label (MEM_* undecided vs no money)", () => {
  it("undecided MEM case says no money decision yet", () => {
    const m = describeMoney({ derived: true, state: "NO_MONEY_EFFECT", group: "NONE_YET", label: "Chưa có quyết định về tiền", postedToMemberWallet: null, memberShortfall: null, referralClawbackShortfall: null } as never);
    assert.equal(m.chip, "Chưa có quyết định về tiền");
  });
  it("falls back to the state label when the server sends none", () => {
    const m = describeMoney({ derived: true, state: "NO_MONEY_EFFECT", label: "", postedToMemberWallet: null, memberShortfall: null, referralClawbackShortfall: null } as never);
    assert.equal(m.chip, "Không phát sinh tiền");
  });
});

import { heldAlreadyResolved } from "../reconciliation/moneyExceptions/heldMoneyModel";
describe("held review of a session whose D65-B already EXECUTED waits for the sweep, no decision offered", () => {
  const p = (sessionId: string, status: string) => ({ id: "x", sessionId, contractId: null, status, reason: "", evidenceRefs: [], proposedBy: null, createdAt: null }) as never;
  it("true only for an EXECUTED proposal of the same session", () => {
    assert.equal(heldAlreadyResolved([p("s1", "EXECUTED")], "s1"), true);
    assert.equal(heldAlreadyResolved([p("s1", "PROPOSED")], "s1"), false);
    assert.equal(heldAlreadyResolved([p("s2", "EXECUTED")], "s1"), false);
    assert.equal(heldAlreadyResolved(null, "s1"), false);
  });
});

import { formatMoneyExact } from "../adminFinanceOverview.utils";
describe("gym money shows the server's exact amount, never rounded (backend 09/11)", () => {
  it("round amounts stay whole, fractional ones keep two decimals", () => {
    assert.match(formatMoneyExact("300000.00"), /^300\.000\s₫$/u);
    assert.match(formatMoneyExact("299999.84"), /^299\.999,84\s₫$/u);
    assert.match(formatMoneyExact("299999.80"), /^299\.999,80\s₫$/u);
    assert.equal(formatMoneyExact(null), "—");
  });
  it("the money view and its sentence carry 299.999,84, not 300.000", () => {
    const m = describeMoney({ derived: true, state: "LEDGER_POSTED_FULL", label: "Đã ghi vào ví Gymini: 299999.84", postedToMemberWallet: "299999.84", memberShortfall: null, referralClawbackShortfall: null } as never);
    assert.match(m.posted ?? "", /299\.999,84/);
    assert.match(m.sentence, /299\.999,84/);
    assert.doesNotMatch(`${m.posted} ${m.sentence}`, /300\.000/);
  });
});
