/** TEST FIXTURE: final V2.1 PT-case shapes; no browser or backend. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detailFixture } from "../disputes/__fixtures__/disputeCaseFixtures";
import { executionControls, executeBody, ackNeedsHumanResultText } from "../disputes/actions/executionModel";
import { normalizeQueueItems } from "../disputes/queue/queueModel";
import { describeExecution, historyLimitNote } from "../disputes/workspace/workspaceModel";

describe("D5 final contract: queue and execution safety", () => {
  it("the paged queue includes both dispute states and case ownership", () => {
    const q = normalizeQueueItems({ total: 51, hasMore: true, items: [
      { sessionId: "s1", sessionStatus: "DISPUTED", clientUserId: "c1", ptUserId: "p1", clientName: "An", ptName: "Bình", hasCase: true, caseId: "case-1" },
      { sessionId: "s2", sessionStatus: "PT_NO_SHOW_REPORTED", clientUserId: "c2", ptUserId: "p2", hasCase: false, needsCase: true },
    ] });
    assert.equal(q.total, 51);
    assert.equal(q.hasMore, true);
    assert.deepEqual(q.rows.map((r) => r.sessionStatus), ["DISPUTED", "PT_NO_SHOW_REPORTED"]);
    assert.equal(q.rows[0].caseId, "case-1");
    assert.equal(q.rows[1].needsCase, true);
  });
  it("capability unknown/off and missing allowed action never show execute", () => {
    const d = detailFixture();
    d.case.status = "DECISION_APPROVED";
    d.allowedActions = ["execute"] as never;
    assert.equal(executionControls(d, "admin-1", null).execute, false);
    assert.equal(executionControls(d, "admin-1", { execution: false }).execute, false);
    assert.equal(executionControls({ ...d, allowedActions: [] }, "admin-1", { execution: true }).execute, false);
  });
  it("execute body only chooses the decision; STAYS_LOCKED never reads as money success", () => {
    const d = detailFixture();
    d.case.execDecisionId = "decision-1";
    assert.deepEqual(executeBody(d), { decisionId: "decision-1" });
    const r = ackNeedsHumanResultText({ action: "STAYS_LOCKED", reason: "SESSION_STILL_DISPUTED_FINISHING_WOULD_MOVE_MONEY" } as never);
    assert.equal(r.tone, "warning");
    assert.match(r.text, /không có tiền nào được chuyển/);
  });
  it("execution state comes from the final block; truncated events are disclosed", () => {
    const d = { ...detailFixture(), execution: { status: "NEEDS_HUMAN", blockers: [], history: [] }, eventsLimit: 200, eventsTruncated: true } as never;
    assert.equal(describeExecution(d).status, "NEEDS_HUMAN");
    assert.match(historyLimitNote(d) ?? "", /200 sự kiện/);
  });
});
