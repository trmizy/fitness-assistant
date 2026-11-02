/** Pure rules of the backend-completion track (no database, no network): allowedActions, the orphan rule, the unreadable-live-source distinction, notice wording. Evidence label: unit (pure functions). */
import test from "node:test";
import assert from "node:assert/strict";
import { ACTION_NAMES, allowedList, computeAllowedActions, isOrphanCase, type AllowedActionsInput } from "../services/dispute-case/allowed-actions";
import { diffAgainstSnapshot } from "../services/dispute-case/rules";
import { blockReasonVi, noticesFor } from "../services/dispute-case/notices";

const base = (over: Partial<AllowedActionsInput["c"]> = {}, rest: Partial<AllowedActionsInput> = {}): AllowedActionsInput => ({
  actor: { id: "inv", role: "ADMIN" },
  c: { status: "ASSESSING", type: "PT_DELIVERY", investigatorId: "inv", clientUserId: "client", ptUserId: "pt", execStatus: "NOT_STARTED", version: 3, ...over },
  sessionStatus: "DISPUTED",
  proposerId: null,
  latestFinding: null,
  pendingPolicyReviews: [],
  flags: { executionEnabled: false, evidenceStorageEnabled: false },
  ...rest,
});

test("every action has a verdict; a non-admin is refused everything with ADMIN_ONLY", () => {
  const m = computeAllowedActions(base({}, { actor: { id: "c", role: "CUSTOMER" } }));
  assert.deepEqual(Object.keys(m).sort(), [...ACTION_NAMES].sort());
  assert.deepEqual(allowedList(m), []);
  assert.ok(Object.values(m).every((v) => v.code === "ADMIN_ONLY"));
});

test("investigator in ASSESSING: investigation actions yes, approval/execution no; another admin: only the non-investigator actions", () => {
  const inv = computeAllowedActions(base());
  assert.deepEqual(allowedList(inv).sort(), ["addAssessment", "addClaim", "addIssue", "assign", "proposePolicyEligibility", "recollect", "recordFinding", "requestMore", "share", "transition"].sort());
  assert.deepEqual([...(inv.transition.options ?? [])].sort(), ["AWAITING_PARTIES", "COLLECTING", "TECH_RECONCILIATION"].sort());
  assert.equal(inv.decide.code, "CASE_STATE_NOT_ALLOWED");
  const other = computeAllowedActions(base({}, { actor: { id: "other", role: "ADMIN" } }));
  assert.equal(other.addClaim.code, "NOT_ASSIGNED_INVESTIGATOR");
  assert.equal(other.assign.allowed, true);
  assert.equal(other.recollect.allowed, true);
});

test("approval is four-eyes and conflict-of-interest aware", () => {
  const st = { status: "AWAITING_APPROVAL" };
  assert.equal(computeAllowedActions(base(st, { proposerId: "inv" })).decide.code, "SELF_APPROVAL_FORBIDDEN");
  assert.equal(computeAllowedActions(base(st, { proposerId: "inv", actor: { id: "x", role: "ADMIN" } })).decide.allowed, true);
  assert.equal(computeAllowedActions(base(st, { proposerId: "p2" })).decide.code, "SELF_APPROVAL_FORBIDDEN", "the investigator may not approve even a proposal someone else made");
  const party = computeAllowedActions(base(st, { proposerId: "p2", actor: { id: "client", role: "ADMIN" } }));
  assert.equal(party.decide.code, "CONFLICT_OF_INTEREST");
  assert.equal(party.execute.allowed, false);
  const legacy = computeAllowedActions(base({ ...st, type: "LEGACY_UNCLASSIFIED" }, { proposerId: "p2", actor: { id: "x", role: "ADMIN" } }));
  assert.equal(legacy.decide.code, "CLASSIFICATION_REQUIRED");
});

test("execution axis: execute needs DECISION_APPROVED + a startable exec state + the flag; reconcile only EXECUTING; acknowledge only NEEDS_HUMAN", () => {
  const actor = { id: "x", role: "ADMIN" };
  const flagsOn = { executionEnabled: true, evidenceStorageEnabled: true };
  const approved = (execStatus: string, flags = flagsOn) => computeAllowedActions(base({ status: "DECISION_APPROVED", execStatus }, { actor, flags }));
  assert.equal(approved("NOT_STARTED").execute.allowed, true);
  assert.equal(approved("EXEC_BLOCKED").execute.allowed, true);
  assert.equal(approved("EXECUTING").execute.code, "EXECUTION_NOT_STARTABLE");
  assert.equal(approved("BUSINESS_DONE").execute.code, "EXECUTION_NOT_STARTABLE");
  assert.equal(approved("NEEDS_HUMAN").execute.code, "EXECUTION_NOT_STARTABLE");
  assert.equal(approved("NOT_STARTED", { executionEnabled: false, evidenceStorageEnabled: false }).execute.code, "EXECUTION_DISABLED");
  assert.equal(approved("EXECUTING").reconcileExecution.allowed, true);
  assert.equal(approved("NOT_STARTED").reconcileExecution.code, "NOTHING_TO_RECONCILE");
  assert.equal(approved("NEEDS_HUMAN").acknowledgeNeedsHuman.allowed, true);
  assert.equal(approved("EXECUTING").acknowledgeNeedsHuman.code, "NOT_NEEDS_HUMAN");
  assert.equal(approved("NOT_STARTED").readEvidenceFile.allowed, true);
  assert.equal(computeAllowedActions(base({ status: "AWAITING_APPROVAL" }, { actor })).execute.code, "CASE_STATE_NOT_ALLOWED");
});

test("orphan: only a non-terminal case whose session is neither DISPUTED nor PT_NO_SHOW_REPORTED; a closed or approved case never is", () => {
  assert.equal(isOrphanCase("ASSESSING", "CANCELLED"), true);
  assert.equal(isOrphanCase("INTAKE", "COMPLETED"), true);
  assert.equal(isOrphanCase("ASSESSING", "DISPUTED"), false);
  assert.equal(isOrphanCase("ASSESSING", "PT_NO_SHOW_REPORTED"), false);
  assert.equal(isOrphanCase("DECISION_APPROVED", "CANCELLED"), false);
  assert.equal(isOrphanCase("REJECTED_INTAKE", "CANCELLED"), false);
  assert.equal(isOrphanCase("ASSESSING", null), false, "an unknown session is never called orphan");
  assert.equal(computeAllowedActions(base({}, { actor: { id: "x", role: "ADMIN" }, sessionStatus: "COMPLETED" })).closeOrphan.allowed, true);
  assert.equal(computeAllowedActions(base({ status: "REJECTED_INTAKE" }, { actor: { id: "x", role: "ADMIN" }, sessionStatus: "COMPLETED" })).closeOrphan.code, "CASE_STATE_NOT_ALLOWED");
  assert.equal(computeAllowedActions(base({}, { actor: { id: "client", role: "ADMIN" }, sessionStatus: "COMPLETED" })).closeOrphan.code, "CONFLICT_OF_INTEREST");
});

test("not-a-dispute closing needs the investigator, FINDING_RECORDED and a NOT_A_DISPUTE finding; propose is refused for it", () => {
  const m = computeAllowedActions(base({ status: "FINDING_RECORDED" }, { latestFinding: "NOT_A_DISPUTE" }));
  assert.equal(m.closeNotADispute.allowed, true);
  assert.equal(m.propose.code, "DESIGN_REQUIRED");
  const other = computeAllowedActions(base({ status: "FINDING_RECORDED" }, { latestFinding: "VERIFIED_PT_ABSENT" }));
  assert.equal(other.closeNotADispute.code, "FINDING_NOT_A_DISPUTE");
  assert.equal(other.propose.allowed, true);
});

test("F5 rule: an unreadable live source is reported apart from a changed one and does not count as a change", () => {
  const r = diffAgainstSnapshot({ snapshot: [], current: [], staleLive: [], unreadableLive: ["chat#CALL_SESSIONS"] });
  assert.equal(r.changed, false);
  assert.deepEqual(r.unreadableLive, ["chat#CALL_SESSIONS"]);
  assert.deepEqual(diffAgainstSnapshot({ snapshot: [], current: [], staleLive: [] }).unreadableLive, []);
});

test("notices: Vietnamese, no money claim, no enum; the actor is not told about their own action; unknown reason codes fall back to words", () => {
  const c = { id: "c1", clientUserId: "client", ptUserId: "pt", investigatorId: "inv" };
  const texts = [
    ...["OPENED", "EVIDENCE_REQUESTED", "FINDING_RECORDED", "CLOSED"].flatMap((k) => noticesFor(k as never, c).notices.map((n) => n.text)),
    ...noticesFor("DECISION_APPROVED", c, { actorId: "approver" }).notices.map((n) => n.text),
    ...noticesFor("EXECUTED", c, { actorId: "x" }).notices.map((n) => n.text),
    ...noticesFor("EXEC_BLOCKED", c, { actorId: "x", reasonCode: "LEDGER_UNREADABLE" }).notices.map((n) => n.text),
  ];
  for (const t of texts) {
    assert.ok(/[À-ỹ]/.test(t), t);
    assert.ok(!/(đã|được)\s+(trả|thanh toán|hoàn tiền|chuyển khoản)/i.test(t), t);
    assert.ok(!/[A-Z]{3,}_[A-Z_]{2,}/.test(t), t);
  }
  assert.deepEqual(noticesFor("DECISION_APPROVED", c, { actorId: "inv" }).notices.map((n) => n.userId).sort(), ["client", "pt"]);
  assert.deepEqual(noticesFor("ASSIGNED", c, { actorId: "inv", assigneeId: "inv" }).notices, []);
  assert.equal(noticesFor("AWAITING_APPROVAL", c).notices.length, 0);
  assert.ok(noticesFor("AWAITING_APPROVAL", c).adminBroadcast);
  assert.match(blockReasonVi("SOMETHING_NEW"), /người xem xét/);
});
