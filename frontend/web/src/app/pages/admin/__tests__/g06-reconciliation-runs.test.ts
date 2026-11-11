/**
 * G-06 — pure part of the balance view: P3 keeps its 200/409 contract, the POST error text, and the "Lịch sử đối soát" list mapping.
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/g06-reconciliation-runs.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { balanceVerdict, normalizeReconciliation, reconciliationFromHttpError } from "../adminFinanceOverview.utils";
import {
  normalizeReconciliationRuns,
  runReconciliationErrorText,
  runDriftText,
  runStatusLabel,
  runStatusTone,
  runTimeText,
  runTriggerLabel,
} from "../reconciliation/reconciliationView";

const BALANCED_BODY = {
  success: true,
  data: { escrow: "1000.00", claims: "1000.00", drift: "0.00", balanced: true, breakdown: { clientBalances: "1000.00" }, negativeWallets: [] },
};
const DRIFT_BODY = {
  success: false,
  data: { escrow: "1000.00", claims: "1250.50", drift: "-250.50", balanced: false, breakdown: { clientBalances: "1250.50" }, negativeWallets: [] },
};

describe("P3 keeps its contract (200 / 409 with { success, data })", () => {
  it("200 { success, data } is a balanced report", () => {
    const r = normalizeReconciliation(BALANCED_BODY)!;
    assert.equal(balanceVerdict(r).balanced, true);
  });
  it("409 { success:false, data } is a drift with the exact numbers, not a load error", () => {
    const r = reconciliationFromHttpError({ response: { status: 409, data: DRIFT_BODY } })!;
    assert.ok(r);
    assert.equal(r.drift, "-250.50");
    assert.equal(balanceVerdict(r).balanced, false);
    assert.equal(balanceVerdict(r).driftCents, -25050n);
  });
  it("other statuses and unreadable bodies are not swallowed", () => {
    assert.equal(reconciliationFromHttpError({ response: { status: 500, data: DRIFT_BODY } }), null);
    assert.equal(reconciliationFromHttpError({ response: { status: 409, data: {} } }), null);
    assert.equal(normalizeReconciliation({ success: true, data: { escrow: "x" } }), null);
  });
});

describe("POST run: error text", () => {
  const err = (status?: number) => ({ response: status === undefined ? undefined : { status } });
  it("429 says it just ran; 500 and unknown errors say nothing was saved", () => {
    assert.equal(runReconciliationErrorText(err(429)), "Vừa chạy xong, thử lại sau ít giây.");
    assert.match(runReconciliationErrorText(err(500)), /Chưa có kết quả nào được lưu/);
    assert.match(runReconciliationErrorText(err()), /Chưa có kết quả nào được lưu/);
    assert.match(runReconciliationErrorText(new Error("network")), /Chưa có kết quả nào được lưu/);
    assert.match(runReconciliationErrorText(err(403)), /quyền/);
  });
});

const run = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  startedAt: "2026-11-11T07:05:00.000Z",
  finishedAt: "2026-11-11T07:05:01.000Z",
  trigger: "JOB",
  triggeredBy: null,
  status: "BALANCED",
  escrowBalance: "100.00",
  claimsTotal: "100.00",
  drift: "0.00",
  summary: {},
  errorCode: null,
  ...over,
});

describe("runs list mapping", () => {
  it("maps a page; amounts stay the exact strings", () => {
    const page = normalizeReconciliationRuns({ total: 3, limit: 20, offset: 0, hasMore: false, items: [run(), run({ id: "r2", status: "DRIFT", drift: "-2.25" })] })!;
    assert.equal(page.total, 3);
    assert.equal(page.items.length, 2);
    assert.equal(page.items[1].drift, "-2.25");
    assert.equal(page.hasMore, false);
  });
  it("a malformed body is null (the screen shows a load error, not an empty history)", () => {
    for (const bad of [null, undefined, {}, { items: [] }, { total: 1, limit: 20, offset: 0, items: [{ id: 1 }] }, { total: "1", limit: 20, offset: 0, items: [] }, []]) {
      assert.equal(normalizeReconciliationRuns(bad), null, JSON.stringify(bad));
    }
  });
  it("an empty history is a valid page, distinct from a failure", () => {
    const page = normalizeReconciliationRuns({ total: 0, limit: 20, offset: 0, hasMore: false, items: [] })!;
    assert.deepEqual(page.items, []);
  });
  it("labels: Vietnamese, no raw enum", () => {
    assert.equal(runTriggerLabel("ADMIN"), "Quản trị viên");
    assert.equal(runTriggerLabel("JOB"), "Hệ thống tự chạy");
    assert.equal(runTriggerLabel("???"), "Không rõ");
    assert.equal(runStatusLabel("BALANCED"), "Cân bằng");
    assert.equal(runStatusLabel("DRIFT"), "Lệch sổ");
    assert.equal(runStatusLabel("ERROR"), "Lỗi khi đối soát");
    assert.equal(runStatusLabel(undefined), "Không rõ");
    assert.equal(runStatusTone("BALANCED"), "success");
    assert.equal(runStatusTone("DRIFT"), "danger");
    assert.equal(runStatusTone("ERROR"), "warning");
  });
  it("drift text: exact amount via formatMoneyExact; an ERROR run is '—', never '0 ₫'", () => {
    assert.equal(runDriftText({ status: "DRIFT", drift: "-2.25" }).replace(/\s/g, " "), "-2,25 ₫".replace(/\s/g, " "));
    assert.match(runDriftText({ status: "BALANCED", drift: "0.00" }), /^0\s?₫$/);
    assert.equal(runDriftText({ status: "ERROR", drift: null }), "—");
    assert.equal(runDriftText({ status: "ERROR", drift: "0.00" }), "—");
    assert.equal(runDriftText({ status: "DRIFT", drift: null }), "—");
  });
  it("time is shown in Vietnam time", () => {
    assert.equal(runTimeText({ startedAt: "2026-11-11T07:05:00.000Z" }), "11/11/2026 14:05");
    assert.equal(runTimeText({ startedAt: "garbage" }), "—");
  });
});
