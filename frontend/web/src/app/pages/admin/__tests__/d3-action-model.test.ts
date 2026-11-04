/**
 * D3 - pure model of the Case Workspace write forms. Evidence label: TEST FIXTURE (pure functions + a fake HTTP client; no server).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d3-action-model.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDisputeCaseApi, type DisputeHttpClient } from "../disputes/disputeCaseApi";
import { parseDisputeErrorBody } from "../disputes/disputeCaseErrors";
import { manualTransitions } from "../disputes/disputeCaseLabels";
import { CASE_STATUSES, FINDING_KINDS, type CaseStatus, type DisputeCaseDetail } from "../disputes/disputeCaseTypes";
import { IDS, detailFixture, errBodies } from "../disputes/__fixtures__/disputeCaseFixtures";
import * as M from "../disputes/actions/actionModel";
import * as T from "../disputes/actions/actionText";
import { APPROVED_DONE } from "../disputes/actions/actionText";
import { FINDING_CONSEQUENCE } from "../disputes/disputeCaseLabels";

const ME = IDS.admin1;
const OTHER = "admin-0009";

function withCase(over: Partial<DisputeCaseDetail["case"]>, extra: Partial<DisputeCaseDetail> = {}): DisputeCaseDetail {
  const d = detailFixture();
  return { ...d, ...extra, case: { ...d.case, ...over } };
}
const str = (n: number, ch = "a") => ch.repeat(n);

describe("D3 permissions: which forms are shown (the server stays the authority)", () => {
  const listed = (actions: string[], extra: Partial<DisputeCaseDetail> = {}) => withCase({ status: "ASSESSING" }, { allowedActions: actions as never, ...extra });
  it("missing server list fails closed for every write", () => {
    const a = M.availability(withCase({ status: "ASSESSING" }), ME);
    assert.equal(a.serverList, false);
    for (const k of ["assign", "recollect", "transition", "requestMore", "classify", "addClaim", "addIssue", "assess", "recordFinding", "propose", "ack", "share", "decide", "execute"] as const) assert.equal(a[k], false, k);
    assert.equal(M.investigatorOnlyLine(withCase({ status: "ASSESSING" }), ME), T.NO_SERVER_LIST_LINE);
  });
  it("an explicit list offers only named actions and never acts for a signed-out user", () => {
    const d = listed(["assign", "recollect", "addClaim", "addAssessment", "share"]);
    const a = M.availability(d, ME);
    assert.equal(a.assign, true);
    assert.equal(a.recollect, true);
    assert.equal(a.addClaim, true);
    assert.equal(a.assess, true);
    assert.equal(a.share, true);
    assert.equal(a.propose, false);
    assert.equal(M.availability(d, null).assign, false);
    assert.equal(M.availability({ ...d, claims: [] }, ME).assess, false);
  });
  it("transition targets must be listed by server, and invalid targets are discarded", () => {
    const d = listed(["transition"], { actions: { transition: { allowed: true, options: ["ASSESSING", "BOGUS"] } } as never });
    assert.deepEqual(M.transitionTargets(d), ["ASSESSING"]);
    assert.deepEqual(M.transitionTargets({ ...d, allowedActions: [] }), []);
    assert.deepEqual(manualTransitions("AWAITING_APPROVAL"), []);
  });
  it("server refusal code—not a local role guess—explains investigator-only access", () => {
    const d = listed([], { actions: { addClaim: { allowed: false, code: "NOT_ASSIGNED_INVESTIGATOR" } } as never });
    assert.match(M.investigatorOnlyLine(d, OTHER) ?? "", /Chỉ điều tra viên được giao hồ sơ này/);
    assert.equal(M.investigatorOnlyLine({ ...d, case: { ...d.case, status: "DECISION_APPROVED" } }, ME), T.TERMINAL_LINE);
  });
});

describe("D3 approvals gate (four eyes, handoff M3)", () => {
  const proposalBy = (proposerId: string, allowed = false, refusalCode?: string) => {
    const d = detailFixture();
    return { ...d, case: { ...d.case, status: "AWAITING_APPROVAL" as const, investigatorId: ME }, proposals: d.proposals.map((p) => ({ ...p, proposerId })), allowedActions: (allowed ? ["decide"] : []) as never, actions: { decide: { allowed, code: refusalCode } } as never };
  };
  it("shown to a third admin only", () => {
    assert.equal(M.decideGate(proposalBy(ME, true), "admin-0003").show, true);
  });
  it("hidden for the proposer, with the reason", () => {
    const g = M.decideGate(proposalBy("admin-0003", false, "SELF_APPROVAL_FORBIDDEN"), "admin-0003");
    assert.equal(g.show, false);
    assert.equal(g.reason, T.CANNOT_APPROVE_PROPOSER);
  });
  it("hidden for the investigator, with the reason", () => {
    const g = M.decideGate(proposalBy("admin-0003", false, "SELF_APPROVAL_FORBIDDEN"), ME);
    assert.equal(g.show, false);
    assert.equal(g.reason, T.CANNOT_APPROVE_INVESTIGATOR);
  });
  it("hidden outside AWAITING_APPROVAL, without a proposal, and when nobody is signed in", () => {
    assert.equal(M.decideGate({ ...proposalBy("x"), case: { ...proposalBy("x").case, status: "ASSESSING" } }, "admin-0003").show, false);
    assert.equal(M.decideGate({ ...proposalBy("x"), proposals: [] }, "admin-0003").show, false);
    assert.equal(M.decideGate(proposalBy("x"), null).show, false);
  });
  it("the NEWEST proposal decides who the proposer is", () => {
    const d = proposalBy("old-proposer");
    const newer = { ...d.proposals[0], id: "p-new", proposerId: "admin-0003", createdAt: "2026-11-02T09:00:00.000Z" };
    const g = M.decideGate({ ...d, actions: { decide: { allowed: false, code: "SELF_APPROVAL_FORBIDDEN" } } as never, proposals: [d.proposals[0], newer] }, "admin-0003");
    assert.equal(g.show, false);
  });
  it("summary: finding, outcome, consequence and the 'can not run yet' sentence come from the proposal", () => {
    const d = proposalBy("x");
    d.proposals[0].executionBlockedReason = "D77_COMBINATION_UNRESOLVED";
    const s = M.approvalSummary(d)!;
    assert.equal(s.findingTitle, "PT vắng mặt");
    assert.equal(s.outcomeTitle, "Xác nhận PT vắng mặt");
    assert.equal(s.consequence, FINDING_CONSEQUENCE.VERIFIED_PT_ABSENT);
    assert.match(s.blocked ?? "", /^Quyết định sẽ được duyệt nhưng chưa thực thi được/);
    assert.doesNotMatch(JSON.stringify(s), /D77|SLICE_2|BLOCKED:/);
    d.proposals[0].executionBlockedReason = null;
    assert.equal(M.approvalSummary(d)!.blocked, null);
  });
  it("EVIDENCE_CHANGED has exactly two branches", () => {
    const re = parseDisputeErrorBody(409, errBodies.evidenceChangedStale, { action: "write" });
    const ack = parseDisputeErrorBody(409, errBodies.evidenceChanged, { action: "write" });
    assert.equal(M.evidenceChangeBranch(re), "recollect");
    assert.equal(M.evidenceChangeBranch(ack), "acknowledge");
    assert.equal(M.evidenceChangeBranch(parseDisputeErrorBody(409, errBodies.versionConflict, { action: "write" })), null);
    assert.equal(M.evidenceChangeBranch(null), null);
    // staleLive alone (needsRecollect missing) is still the recollect branch
    const odd = parseDisputeErrorBody(409, { error: "x", code: "EVIDENCE_CHANGED", details: { changedIds: ["a"], staleLive: ["s"] } }, { action: "write" });
    assert.equal(M.evidenceChangeBranch(odd), "recollect");
  });
  it("validation: reason required even to approve, COI must be ticked, reason <= 4000", () => {
    const f = { result: "APPROVED" as const, reason: "", coi: false, evidenceChangeAcknowledged: false };
    assert.deepEqual(Object.keys(M.validateApproval(f)).sort(), ["conflictOfInterestDeclaredNone", "reason"]);
    assert.deepEqual(M.validateApproval({ ...f, reason: str(4000), coi: true }), {});
    assert.ok(M.validateApproval({ ...f, reason: str(4001), coi: true }).reason);
    assert.ok(M.validateApproval({ ...f, reason: "   ", coi: true }).reason, "whitespace only is empty (the server trims)");
  });
  it("approval body: only the four documented fields, COI is a real boolean", () => {
    const b = M.approvalBody({ result: "REJECTED", reason: "  lý do  ", coi: true, evidenceChangeAcknowledged: false });
    assert.deepEqual(b, { result: "REJECTED", reason: "lý do", conflictOfInterestDeclaredNone: true, evidenceChangeAcknowledged: false });
  });
});

describe("D3 limits copied from schemas.ts (boundary: max passes, max+1 fails, measured after trim)", () => {
  const ok = (e: M.Errors) => Object.keys(e).length === 0;
  it("transition", () => {
    assert.ok(ok(M.validateTransition({ to: "COLLECTING", reason: "", note: "" }, "INTAKE")));
    assert.ok(ok(M.validateTransition({ to: "COLLECTING", reason: "", note: str(2000) }, "INTAKE")));
    assert.ok(M.validateTransition({ to: "COLLECTING", reason: "", note: str(2001) }, "INTAKE").note);
    assert.ok(M.validateTransition({ to: "", reason: "", note: "" }, "INTAKE").to);
    assert.ok(M.validateTransition({ to: "ASSESSING", reason: "", note: "" }, "INTAKE").to, "not a legal manual step from INTAKE");
  });
  it("reason is REQUIRED for REJECTED_INTAKE only", () => {
    assert.ok(M.validateTransition({ to: "REJECTED_INTAKE", reason: "", note: "" }, "INTAKE").reason);
    assert.ok(M.validateTransition({ to: "REJECTED_INTAKE", reason: "   ", note: "" }, "INTAKE").reason);
    assert.ok(ok(M.validateTransition({ to: "REJECTED_INTAKE", reason: str(2000), note: "" }, "INTAKE")));
    assert.ok(M.validateTransition({ to: "REJECTED_INTAKE", reason: str(2001), note: "" }, "INTAKE").reason);
    assert.deepEqual(M.transitionBody({ to: "REJECTED_INTAKE", reason: " x ", note: "ignored" }), { to: "REJECTED_INTAKE", reason: "x" });
    assert.deepEqual(M.transitionBody({ to: "COLLECTING", reason: "ignored", note: " n " }), { to: "COLLECTING", note: "n" });
    assert.deepEqual(M.transitionBody({ to: "COLLECTING", reason: "", note: "" }), { to: "COLLECTING" });
  });
  it("request more: note 1..2000 required", () => {
    assert.ok(M.validateRequestMore({ to: "AWAITING_PARTIES", note: "" }).note);
    assert.ok(ok(M.validateRequestMore({ to: "COLLECTING", note: str(2000) })));
    assert.ok(M.validateRequestMore({ to: "COLLECTING", note: str(2001) }).note);
    assert.deepEqual(M.requestMoreBody({ to: "COLLECTING", note: " a " }), { to: "COLLECTING", note: "a" });
  });
  it("claim: text 1..4000, <=3 moves, role enum", () => {
    assert.ok(M.validateClaim({ claimantRole: "", text: "x", moves: [] }).claimantRole);
    assert.ok(M.validateClaim({ claimantRole: "PT", text: "", moves: [] }).text);
    assert.ok(ok(M.validateClaim({ claimantRole: "PT", text: str(4000), moves: ["MONEY", "QUOTA", "PT_AT_FAULT"] })));
    assert.ok(M.validateClaim({ claimantRole: "PT", text: str(4001), moves: [] }).text);
    assert.ok(M.validateClaim({ claimantRole: "PT", text: "x", moves: ["MONEY", "QUOTA", "PT_AT_FAULT", "MONEY"] }).moves);
    assert.deepEqual(M.claimBody({ claimantRole: "CLIENT", text: " a ", moves: ["MONEY", "MONEY"] }), { claimantRole: "CLIENT", text: "a", moves: ["MONEY"] });
  });
  it("PT-late issue: finding enum, note optional <= 4000", () => {
    assert.ok(M.validateIssue({ finding: "", note: "" }).finding);
    assert.ok(ok(M.validateIssue({ finding: "NOT_LATE", note: "" })));
    assert.ok(ok(M.validateIssue({ finding: "NOT_LATE", note: str(4000) })));
    assert.ok(M.validateIssue({ finding: "NOT_LATE", note: str(4001) }).note);
    assert.deepEqual(M.issueBody({ finding: "LATE_CONTESTED", note: "  " }), { finding: "LATE_CONTESTED" });
  });
  it("assessment: three notes 1..4000, reasoning 1..8000, result enum, claim in the case", () => {
    const base: M.AssessmentForm = { claimId: "c1", groups: {}, relevanceNote: "a", verifiabilityNote: "b", consistencyNote: "c", result: "ESTABLISHED", reasoning: "r" };
    assert.ok(ok(M.validateAssessment(base, ["c1"])));
    assert.ok(M.validateAssessment({ ...base, claimId: "zzz" }, ["c1"]).claimId);
    for (const k of ["relevanceNote", "verifiabilityNote", "consistencyNote"] as const) {
      assert.ok(M.validateAssessment({ ...base, [k]: "" }, ["c1"])[k], `${k} required`);
      assert.ok(ok(M.validateAssessment({ ...base, [k]: str(4000) }, ["c1"])));
      assert.ok(M.validateAssessment({ ...base, [k]: str(4001) }, ["c1"])[k]);
    }
    assert.ok(ok(M.validateAssessment({ ...base, reasoning: str(8000) }, ["c1"])));
    assert.ok(M.validateAssessment({ ...base, reasoning: str(8001) }, ["c1"]).reasoning);
    assert.ok(M.validateAssessment({ ...base, result: "" }, ["c1"]).result);
  });
  it("finding reasoning 1..8000; proposal note optional <= 2000; ack note 1..2000; share reason 1..2000", () => {
    assert.ok(M.validateFinding({ finding: "", reasoning: "x" }).finding);
    assert.ok(ok(M.validateFinding({ finding: "VERIFIED_DELIVERED", reasoning: str(8000) })));
    assert.ok(M.validateFinding({ finding: "VERIFIED_DELIVERED", reasoning: str(8001) }).reasoning);
    assert.ok(ok(M.validateProposal({ note: "" })));
    assert.ok(ok(M.validateProposal({ note: str(2000) })));
    assert.ok(M.validateProposal({ note: str(2001) }).note);
    assert.ok(M.validateAck("").note);
    assert.ok(ok(M.validateAck(str(2000))));
    assert.ok(M.validateAck(str(2001)).note);
    const share = { targetId: "e1", role: "CLIENT" as const, reason: "r" };
    assert.ok(ok(M.validateShare(share, ["e1"])));
    assert.ok(M.validateShare({ ...share, reason: "" }, ["e1"]).reason);
    assert.ok(M.validateShare({ ...share, reason: str(2001) }, ["e1"]).reason);
    assert.ok(M.validateShare({ ...share, role: "" }, ["e1"]).sharedWithRole);
    assert.ok(M.validateShare({ ...share, targetId: "nope" }, ["e1"]).target);
  });
  it("assign: id <= 64; empty = take it yourself (no field sent)", () => {
    assert.deepEqual(M.assignBody({ investigatorId: "" }), {});
    assert.deepEqual(M.assignBody({ investigatorId: " u1 " }), { investigatorId: "u1" });
    assert.ok(M.validateAssign({ investigatorId: str(65) }).investigatorId);
    assert.ok(ok(M.validateAssign({ investigatorId: str(64) })));
  });
  it("proposal body: a note at most, never an outcome or an amount", () => {
    assert.deepEqual(M.proposalBody({ note: "" }), {});
    assert.deepEqual(M.proposalBody({ note: " n " }), { note: "n" });
  });
});

describe("D3 evidence groups: an id can not be in two groups", () => {
  it("splitGroups of an assignment never repeats an id (one value per id)", () => {
    const g = M.splitGroups({ a: "direct", b: "indirect", c: "rebuttal", d: "direct" });
    assert.deepEqual(g, { direct: ["a", "d"], indirect: ["b"], rebuttal: ["c"] });
    assert.equal(M.duplicatedEvidenceId(g.direct, g.indirect, g.rebuttal), null);
  });
  it("duplicatedEvidenceId finds a repeat across groups (belt and braces on the final body)", () => {
    assert.equal(M.duplicatedEvidenceId(["a"], ["b"], ["a"]), "a");
    assert.equal(M.duplicatedEvidenceId(["a", "a"], [], []), "a");
  });
  it("validateAssessment refuses >100 per group", () => {
    const groups: M.GroupAssignment = {};
    for (let i = 0; i < 101; i++) groups[`e${i}`] = "direct";
    const f: M.AssessmentForm = { claimId: "c", groups, relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "REFUTED", reasoning: "a" };
    assert.ok(M.validateAssessment(f, ["c"]).groups);
  });
  it("assessment body carries the three arrays, notes, result, reasoning and nothing else", () => {
    const b = M.assessmentBody({ claimId: "c", groups: { a: "direct", b: "rebuttal" }, relevanceNote: " 1 ", verifiabilityNote: " 2 ", consistencyNote: " 3 ", result: "NOT_ESTABLISHED", reasoning: " r " });
    assert.deepEqual(Object.keys(b).sort(), ["claimId", "consistencyNote", "directEvidenceIds", "indirectEvidenceIds", "reasoning", "rebuttalEvidenceIds", "relevanceNote", "result", "verifiabilityNote"]);
    assert.deepEqual(b.directEvidenceIds, ["a"]);
    assert.deepEqual(b.indirectEvidenceIds, []);
    assert.deepEqual(b.rebuttalEvidenceIds, ["b"]);
    assert.equal(b.relevanceNote, "1");
  });
  it("evidenceChoices lists the CURRENT row of each slot, with the unreadable ones marked", () => {
    const d = detailFixture();
    const c = M.evidenceChoices(d);
    assert.equal(c.length, d.evidence.length);
    assert.ok(c.every((x) => /mã [0-9a-f]{8}/.test(x.label)), "short ref, not a full uuid");
    assert.ok(!c.some((x) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(x.label)));
  });
  it("unassessedClaims", () => {
    const d = detailFixture();
    assert.equal(M.unassessedClaims({ claims: d.claims, assessments: d.assessments }).length, 0);
    assert.equal(M.unassessedClaims({ claims: d.claims, assessments: [] }).length, 1);
  });
});

describe("D3 share: exactly one of evidenceId / statementId; only what the server would accept is offered", () => {
  const base = { partySubmitted: false, verificationStatus: "NOT_APPLICABLE", sensitivity: "NORMAL", captureStatus: "OK", provenanceType: "SERVER_OBSERVED" } as const;
  it("shareable matrix mirrors shareRefusalReason", () => {
    assert.equal(M.isShareableEvidence(base), true);
    assert.equal(M.isShareableEvidence({ ...base, verificationStatus: "SERVER_VERIFIED" }), true);
    assert.equal(M.isShareableEvidence({ ...base, partySubmitted: true }), false, "party-submitted");
    assert.equal(M.isShareableEvidence({ ...base, partySubmitted: true, verificationStatus: "SERVER_VERIFIED" }), false, "even a verified party file");
    assert.equal(M.isShareableEvidence({ ...base, verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" }), false, "unverified");
    assert.equal(M.isShareableEvidence({ ...base, sensitivity: "SENSITIVE" }), false);
    assert.equal(M.isShareableEvidence({ ...base, sensitivity: "RESTRICTED" }), false);
    assert.equal(M.isShareableEvidence({ ...base, captureStatus: "UNAVAILABLE" }), false, "unreadable source");
    assert.equal(M.isShareableEvidence({ ...base, provenanceType: "TECH_GAP" }), false);
  });
  it("from the case fixture only the two system rows are offered, never the party document", () => {
    const d = detailFixture();
    const ids = M.shareableEvidenceChoices(d).map((c) => c.id);
    assert.deepEqual(ids.sort(), [IDS.ev1, IDS.ev2].sort());
    assert.ok(!ids.includes(IDS.ev3));
  });
  it("body has exactly one target key", () => {
    const f = { targetId: "id1", role: "PT" as const, reason: " r " };
    const e = M.shareBody("evidence", f);
    const s = M.shareBody("statement", f);
    assert.deepEqual(Object.keys(e).sort(), ["evidenceId", "reason", "sharedWithRole"]);
    assert.deepEqual(Object.keys(s).sort(), ["reason", "sharedWithRole", "statementId"]);
    assert.equal(e.reason, "r");
  });
  it("statements are labelled by party and version, never by raw id alone", () => {
    const c = M.statementChoices(detailFixture().statements);
    assert.equal(c.length, 1);
    assert.match(c[0].label, /^Khách, phiên bản 1 \(mã [0-9a-f]{8}\)$/);
  });
});

describe("D3 findings: consequence of the selected finding", () => {
  it("all six findings have a view; only the four verified ones have an outcome", () => {
    const v = FINDING_KINDS.map((f) => M.consequenceFor(f));
    assert.deepEqual(v.map((x) => x.proposalPossible), [true, true, true, true, false, false]);
    assert.equal(v[2].outcomeLabel, "Xác nhận PT vắng mặt");
    assert.match(v[2].consequence, /vẫn mất 1 quyền buổi/);
    assert.doesNotMatch(v.map((x) => x.consequence).join("\n"), /buổi tập không bị trừ/);
    assert.equal(v[5].outcomeLabel, "Chưa có kết quả");
  });
});

describe("D3 admin list for assignment (never a typed id)", () => {
  const raw = {
    success: true,
    data: {
      total: 6,
      users: [
        { id: "a1", name: "An", email: "an@x.vn", role: "Admin", status: "Active" },
        { id: "me", name: "Tôi", email: "me@x.vn", role: "Admin", status: "Active" },
        { id: "a2", name: "Bình", email: "b@x.vn", role: "Admin", status: "Inactive" },
        { id: "c1", name: "Khách", email: "k@x.vn", role: "Client", status: "Active" },
        { id: "a1", name: "An lặp", email: "an2@x.vn", role: "Admin", status: "Active" },
        { id: "", name: "Rỗng", role: "Admin", status: "Active" },
      ],
    },
  };
  it("keeps real, active ADMIN rows only; drops self, inactive, non-admin, duplicates, empty ids", () => {
    assert.deepEqual(M.parseAdminOptions(raw, "me"), [{ id: "a1", label: "An (an@x.vn)" }]);
  });
  it("malformed answers -> empty list, never throws", () => {
    for (const bad of [null, undefined, {}, { data: {} }, { data: { users: "x" } }, 5, "s"]) assert.deepEqual(M.parseAdminOptions(bad, "me"), []);
  });
  it("an id longer than the 64-char limit is never offered", () => {
    assert.deepEqual(M.parseAdminOptions({ data: { users: [{ id: "x".repeat(65), name: "N", role: "Admin", status: "Active" }] } }, null), []);
  });
});

describe("D3 server field errors are shown in Vietnamese, next to the field", () => {
  it("maps the first path segment; English Zod text becomes the neutral sentence", () => {
    const v = parseDisputeErrorBody(400, { error: "x", code: "INVALID_INPUT", fields: [{ path: "reason", message: "Required" }, { path: "moves.0", message: "Chọn lại" }] }, { action: "write" });
    assert.deepEqual(M.fieldErrorsFromView(v), { reason: T.FIELD_FALLBACK, moves: "Chọn lại" });
    assert.deepEqual(M.fieldErrorsFromView(null), {});
  });
});

describe("D3 wire bodies through the real D1 client (fake transport): no forbidden field, one Idempotency-Key", () => {
  const seen: Array<{ url: string; data: Record<string, unknown>; key: string }> = [];
  const client: DisputeHttpClient = {
    async request(cfg) {
      seen.push({ url: String(cfg.url), data: (cfg.data ?? {}) as Record<string, unknown>, key: String(cfg.headers?.["Idempotency-Key"] ?? "") });
      if (String(cfg.url).endsWith("/proposals")) return { data: { proposalCreated: true, id: "proposal-1", outcome: "COMPLETED", caseStatus: "AWAITING_APPROVAL" } as never, status: 201 };
      return { data: {} as never, status: 200 };
    },
  };
  const api = createDisputeCaseApi(client);
  const FORBIDDEN = ["userId", "adminId", "approvedBy", "approverId", "proposerId", "amount", "outcome", "version", "status", "executionBlockedReason", "decisionId", "execution"];
  it("every form body, built by the model and sent by the client", async () => {
    seen.length = 0;
    const c = "case-1";
    await api.assign(c, M.assignBody({ investigatorId: "u1" }), "k1");
    await api.assign(c, M.assignBody({ investigatorId: "" }), "k1b");
    await api.transition(c, M.transitionBody({ to: "REJECTED_INTAKE", reason: "r", note: "" }), "k2");
    await api.requestMore(c, M.requestMoreBody({ to: "COLLECTING", note: "n" }), "k3");
    await api.classify(c, "PT_DELIVERY", "k4");
    await api.addClaim(c, M.claimBody({ claimantRole: "PT", text: "t", moves: ["MONEY"] }), "k5");
    await api.addIssue(c, M.issueBody({ finding: "UNDETERMINED", note: "" }), "k6");
    await api.addAssessment(c, M.assessmentBody({ claimId: "x", groups: { a: "direct" }, relevanceNote: "1", verifiabilityNote: "2", consistencyNote: "3", result: "REFUTED", reasoning: "r" }), "k7");
    await api.recordFinding(c, M.findingBody({ finding: "VERIFIED_PT_ABSENT", reasoning: "r" }), "k8");
    await api.propose(c, M.proposalBody({ note: "" }), "k9");
    await api.decide(c, M.approvalBody({ result: "APPROVED", reason: "r", coi: true, evidenceChangeAcknowledged: false }), "k10");
    await api.acknowledgeEvidenceChange(c, { note: "n" }, "k11");
    await api.share(c, M.shareBody("evidence", { targetId: "e", role: "CLIENT", reason: "r" }), "k12");
    await api.share(c, M.shareBody("statement", { targetId: "s", role: "PT", reason: "r" }), "k13");
    await api.recollect(c, "k14");
    assert.equal(seen.length, 15);
    for (const s of seen) {
      assert.match(s.key, /^k\d+b?$/, s.url);
      for (const f of FORBIDDEN) assert.ok(!(f in s.data), `${s.url} sent forbidden field ${f}`);
    }
    const by = (suffix: string) => seen.filter((s) => s.url.endsWith(suffix));
    assert.deepEqual(by("/assign")[0].data, { investigatorId: "u1" });
    assert.deepEqual(by("/assign")[1].data, {}, "self assignment sends no id");
    assert.deepEqual(by("/transition")[0].data, { to: "REJECTED_INTAKE", reason: "r" });
    assert.deepEqual(by("/proposals")[0].data, {}, "proposal sends no outcome / amount");
    assert.deepEqual(by("/issues")[0].data, { kind: "PT_LATE", finding: "UNDETERMINED" });
    assert.deepEqual(Object.keys(by("/approvals")[0].data).sort(), ["conflictOfInterestDeclaredNone", "evidenceChangeAcknowledged", "reason", "result"]);
    assert.equal(by("/approvals")[0].data.conflictOfInterestDeclaredNone, true);
    const shares = by("/shares");
    assert.ok("evidenceId" in shares[0].data && !("statementId" in shares[0].data));
    assert.ok("statementId" in shares[1].data && !("evidenceId" in shares[1].data));
    assert.deepEqual(by("/recollect")[0].data, {});
  });
});

describe("D3 fixed wording", () => {
  it("confirmation sentences are exactly handoff section 4", () => {
    assert.equal(T.CONFIRM_APPROVE, "Sau khi duyệt, hồ sơ không thể sửa hay huỷ duyệt.");
    assert.equal(T.CONFIRM_REJECT_PROPOSAL, "Hồ sơ quay lại bước đánh giá.");
    assert.equal(T.CONFIRM_REJECT_INTAKE, "Hồ sơ đóng vĩnh viễn.");
    assert.equal(T.CONFIRM_SHARE, "Không thể thu hồi.");
    assert.equal(T.CONFIRM_ASSIGN, "Người nhận sẽ có quyền làm mọi bước điều tra.");
  });
  it("after an approval the page separates approval from execution and money", () => {
    assert.equal(APPROVED_DONE, "Đã duyệt. Chưa thực thi.");
    assert.match(T.APPROVED_DONE_HELP, /Duyệt chưa làm thay đổi buổi tập, quyền buổi hay tiền/);
  });
  it("no internal code in any D3 sentence", () => {
    const all = (Object.values(T) as unknown[]).filter((v) => typeof v === "string").join("\n");
    assert.doesNotMatch(all, /\bD77\b|\bB-\d\b|\bFH-\d|\bI6\b|DESIGN_REQUIRED|POLICY_PENDING|SLICE_2/);
  });
});
