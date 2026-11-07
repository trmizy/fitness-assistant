/** TEST FIXTURE: D65-B and late-open response interpretation; no real ledger or browser. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { d65bExecutionOf, lateExecutionOf, normalizeCapabilities, recoveryApproveOf } from "../reconciliation/moneyExceptions/moneyExceptionTypes";
import { d65bGates, d65bResultNote } from "../reconciliation/moneyExceptions/moneyExceptionModel";
import { buildProposeD65b, validateProposeD65b } from "../reconciliation/moneyExceptions/moneyExceptionModel";
import { createMoneyExceptionApi, type MoneyHttpClient } from "../reconciliation/moneyExceptions/moneyExceptionApi";

describe("D7 money exception contract", () => {
  it("unknown flags remain off, only explicit true enables a write", () => {
    assert.deepEqual(normalizeCapabilities(null), { d65bResolution: null, lateOpenReconciliation: null });
    assert.deepEqual(normalizeCapabilities({ d65bResolution: true, lateOpenReconciliation: false }), { d65bResolution: true, lateOpenReconciliation: false });
  });
  it("D65-B 202 is approved but not credited", () => {
    assert.deepEqual(d65bExecutionOf(202, { execution: { status: "NOT_EXECUTED", code: "LEDGER_UNAVAILABLE" } }), { kind: "NOT_EXECUTED", code: "LEDGER_UNAVAILABLE" });
    assert.deepEqual(d65bExecutionOf(200, { execution: { status: "EXECUTED", creditedToClient: "250000.00" } }), { kind: "EXECUTED", creditedToClient: "250000.00", replayed: false });
  });
  it("flag-on D65-B still requires a signed-in admin and a different approver", () => {
    const resolution = { id: "r1", sessionId: "s1", status: "PROPOSED", proposedBy: "admin-1" } as never;
    assert.equal(d65bGates({ flag: true, me: null, resolution, preview: null }).approve.show, false);
    const self = d65bGates({ flag: true, me: "admin-1", resolution, preview: null }).approve;
    assert.equal(self.show, true);
    assert.ok(self.disabledReason);
    const other = d65bGates({ flag: true, me: "admin-2", resolution, preview: null }).approve;
    assert.equal(other.disabledReason, null);
    assert.equal(d65bGates({ flag: false, me: "admin-2", resolution, preview: null }).approve.show, false);
    const note = d65bResultNote({ kind: "NOT_EXECUTED", code: "LEDGER_UNAVAILABLE" }, () => "0 ₫");
    assert.doesNotMatch(note.text, /đã hoàn|đã ghi có/i);
  });
  it("P4 sends only structured, verifiable evidence references", () => {
    const form = { reason: "Đã kiểm tra", refs: [{ type: "EVIDENCE" as const, id: "evidence-1", contentHash: "a".repeat(64) }, { type: "LEDGER_OP" as const, key: "LEDGER:END:1" }] };
    assert.deepEqual(validateProposeD65b(form), {});
    assert.deepEqual(buildProposeD65b(form).evidenceRefs, form.refs);
    assert.ok(validateProposeD65b({ reason: "r", refs: [{ type: "LEDGER_OP", key: "" }] }).evidenceRefs);
  });
  it("P6 reject and P7 handover send no actor or amount", async () => {
    const calls: Array<{url:string;data:unknown;headers:Record<string,string>|undefined}> = [];
    const http: MoneyHttpClient = { request: async (config) => { calls.push({url:config.url,data:config.data,headers:config.headers}); return {status:200,data:{status:"REJECTED"} as never}; } };
    const api = createMoneyExceptionApi(http);
    await api.d65bReject("r1", { reason: "Sai bằng chứng", conflictOfInterestDeclaredNone: true }, "key-reject");
    await api.d65bHandover("r1", { reason: "Người duyệt rời vai", conflictOfInterestDeclaredNone: true }, "key-handover");
    assert.deepEqual(calls.map((c) => c.url), ["/admin/unconfirmed-session-resolutions/r1/reject", "/admin/unconfirmed-session-resolutions/r1/handover"]);
    for (const c of calls) assert.deepEqual(Object.keys(c.data as object).sort(), ["conflictOfInterestDeclaredNone", "reason"]);
    assert.equal(calls[0].headers?.["Idempotency-Key"], "key-reject");
  });
  it("P7 202 tells the takeover admin, not the departed approver, how to continue", () => {
    const note = d65bResultNote({ kind: "NOT_EXECUTED", code: "LEDGER_UNAVAILABLE" }, () => "—", true);
    assert.match(note.text, /Quản trị viên đã tiếp quản/);
    assert.doesNotMatch(note.text, /Người đã duyệt chạy lại/);
  });
  it("a rejected proposal can be replaced when the preview remains eligible", () => {
    const resolution = { id: "r1", sessionId: "s1", status: "REJECTED", proposedBy: "admin-1" } as never;
    const preview = { assessment: { eligible: true } } as never;
    assert.equal(d65bGates({ flag: true, me: "admin-2", resolution, preview }).propose.show, true);
  });
  it("late-open HTTP success is not paid unless execution says EXECUTED", () => {
    for (const status of ["BLOCKED", "FAILED", "IN_FLIGHT"] as const) assert.equal(lateExecutionOf({ status }).kind, status);
    assert.equal(lateExecutionOf({ status: "EXECUTED" }).kind, "EXECUTED");
    assert.deepEqual(recoveryApproveOf({ status: "HALTED", haltCode: "EXECUTION_ATTEMPTS_EXHAUSTED" }), { kind: "HALTED", haltCode: "EXECUTION_ATTEMPTS_EXHAUSTED" });
  });
});
