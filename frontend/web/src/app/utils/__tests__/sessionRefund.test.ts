/**
 * DQ-2(a) - the NO_SHOW (PT-fault) label follows the server's refundState. Pure view-model, node:test like the sibling tests.
 * Run: npx tsx --test src/app/utils/__tests__/sessionRefund.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { noShowLabelForClient, noShowLabelForPt, withRefundLabel } from "../sessionRefund";

const norm = (s: string) => s.replace(/\s/g, " ");
const full = { status: "NO_SHOW", refundState: "FULL", refundedAmount: "250000.00", refundPendingAmount: "0.00" } as const;
const partial = { status: "NO_SHOW", refundState: "PARTIAL", refundedAmount: "125000.00", refundPendingAmount: "125000.00" } as const;
const pending = { status: "NO_SHOW", refundState: "PENDING", refundedAmount: "0.00", refundPendingAmount: "250000.00" } as const;

describe("noShowLabelForClient", () => {
  it("says 'đã hoàn tiền' ONLY when the refund is FULL", () => {
    assert.equal(noShowLabelForClient(full), "Không diễn ra — đã hoàn tiền");
    for (const s of [partial, pending, { status: "NO_SHOW" }, { status: "NO_SHOW", refundState: null }]) {
      assert.doesNotMatch(noShowLabelForClient(s), /đã hoàn tiền/);
    }
  });

  it("PARTIAL names the open remainder, PENDING says nothing was refunded yet", () => {
    assert.equal(norm(noShowLabelForClient(partial)), "Không diễn ra — đã hoàn một phần, còn 125.000đ đang chờ xử lý");
    assert.equal(noShowLabelForClient(pending), "Không diễn ra — chưa hoàn, đang chờ xử lý");
  });

  it("an unknown state makes no refund claim at all", () => {
    assert.equal(noShowLabelForClient({ status: "NO_SHOW" }), "Không diễn ra");
    assert.equal(noShowLabelForClient({ status: "NO_SHOW", refundState: null }), "Không diễn ra");
  });

  it("a remainder the owner closed without paying is not 'đang chờ xử lý' and never 'đã hoàn tiền'", () => {
    const closedPartial = { ...partial, refundPendingAmount: "0.00" };
    const closedNone = { ...pending, refundPendingAmount: "0.00" };
    assert.equal(noShowLabelForClient(closedPartial), "Không diễn ra — đã hoàn một phần, phần còn lại đã được đóng");
    assert.equal(noShowLabelForClient(closedNone), "Không diễn ra — không hoàn thêm (đã đóng)");
    for (const s of [closedPartial, closedNone]) assert.doesNotMatch(noShowLabelForClient(s), /đang chờ|đã hoàn tiền/);
  });
});

describe("noShowLabelForPt", () => {
  it("is about the client's refund, not the student's absence", () => {
    assert.equal(noShowLabelForPt(full), "Không diễn ra — đã hoàn tiền cho khách");
    assert.equal(norm(noShowLabelForPt(partial)), "Không diễn ra — hoàn một phần cho khách, còn 125.000đ đang chờ xử lý");
    assert.equal(noShowLabelForPt(pending), "Không diễn ra — hoàn tiền cho khách đang chờ xử lý");
    assert.equal(noShowLabelForPt({ status: "NO_SHOW" }), "Không diễn ra");
    for (const s of [full, partial, pending, { status: "NO_SHOW" }]) assert.doesNotMatch(noShowLabelForPt(s), /Vắng mặt|vắng/i);
  });
});

describe("withRefundLabel", () => {
  const cfg = { label: "Không diễn ra", color: "text-red-400" };
  it("replaces the label of a NO_SHOW session only, keeping the colours", () => {
    assert.deepEqual(withRefundLabel(cfg, full, "CLIENT"), { label: "Không diễn ra — đã hoàn tiền", color: "text-red-400" });
    assert.equal(withRefundLabel(cfg, pending, "PT").label, "Không diễn ra — hoàn tiền cho khách đang chờ xử lý");
  });
  it("never touches a delivered session: a COMPLETED session keeps 'Hoàn thành', even if it carried refund fields", () => {
    const done = { label: "Hoàn thành", color: "text-blue-400" };
    assert.equal(withRefundLabel(done, { status: "COMPLETED", refundState: "FULL" }, "CLIENT"), done);
  });
});
