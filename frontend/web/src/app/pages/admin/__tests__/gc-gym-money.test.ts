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
