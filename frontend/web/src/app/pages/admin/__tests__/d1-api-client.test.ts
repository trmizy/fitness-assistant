/**
 * D1 - typed Dispute Case client: header, URLs, bodies, forbidden fields, the A13 discriminated union, F3 constant dropped.
 * Evidence label: TEST FIXTURE (a fake HTTP client records the calls; no request leaves the process).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d1-api-client.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { IDEMPOTENCY_KEY_PATTERN, createDisputeCaseApi, disputeCaseApi, listDisputedSessions, resolveSessionDispute, type DisputeHttpClient } from "../disputes/disputeCaseApi";
import { adminService } from "../../../services/api";
import { IDS, decideApprovedRaw, detailFixture, proposeCreatedRaw, proposePolicyPendingRaw } from "../disputes/__fixtures__/disputeCaseFixtures";

const dir = dirname(fileURLToPath(import.meta.url));

interface Call {
  method: string;
  url: string;
  data?: Record<string, unknown>;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}
function fake(answer: unknown = {}, status = 200) {
  const calls: Call[] = [];
  const client: DisputeHttpClient = {
    async request(config) {
      calls.push({ method: config.method, url: config.url, data: config.data as Record<string, unknown>, params: config.params, headers: config.headers });
      if (String(config.url).endsWith("/proposals") && !(answer && typeof answer === "object" && "proposalCreated" in answer)) {
        return { data: { proposalCreated: true, id: "proposal-fixture", outcome: "COMPLETED", caseStatus: "AWAITING_APPROVAL" } as never, status: 201 };
      }
      return { data: answer as never, status };
    },
  };
  return { calls, api: createDisputeCaseApi(client) };
}
const KEY = "0b0e6a64-2f5a-4c5e-9d1e-1234567890ab";
const FORBIDDEN = ["userId", "adminId", "approvedBy", "amount", "outcome", "actorId", "clientUserId", "ptUserId"];

describe("D1 API client - Idempotency-Key", () => {
  it("every write sends the header with the key given, and the key matches the server regex", async () => {
    const { calls, api } = fake({ id: "x" });
    await api.openCase("s1", KEY);
    await api.assign(IDS.case, {}, KEY);
    await api.recollect(IDS.case, KEY);
    await api.transition(IDS.case, { to: "COLLECTING" }, KEY);
    await api.requestMore(IDS.case, { note: "n" }, KEY);
    await api.classify(IDS.case, "PT_DELIVERY", KEY);
    await api.addClaim(IDS.case, { claimantRole: "CLIENT", text: "t" }, KEY);
    await api.addIssue(IDS.case, { finding: "NOT_LATE" }, KEY);
    await api.addAssessment(IDS.case, { claimId: IDS.claim, relevanceNote: "a", verifiabilityNote: "b", consistencyNote: "c", result: "ESTABLISHED", reasoning: "r" }, KEY);
    await api.recordFinding(IDS.case, { finding: "VERIFIED_DELIVERED", reasoning: "r" }, KEY);
    await api.propose(IDS.case, {}, KEY);
    await api.decide(IDS.case, { result: "APPROVED", reason: "r", conflictOfInterestDeclaredNone: true }, KEY);
    await api.acknowledgeEvidenceChange(IDS.case, { note: "n" }, KEY);
    await api.proposePolicyEligibility(IDS.case, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [IDS.ev1], reasoning: "r" }, KEY);
    await api.approvePolicyEligibility(IDS.case, IDS.review, { reason: "r", conflictOfInterestDeclaredNone: true }, KEY);
    await api.share(IDS.case, { evidenceId: IDS.ev1, sharedWithRole: "CLIENT", reason: "r" }, KEY);
    await api.submitStatement(IDS.case, { text: "t" }, KEY);
    await api.submitEvidence(IDS.case, { description: "d", sha256: "a".repeat(64) }, KEY);
    assert.equal(calls.length, 18);
    for (const c of calls) {
      assert.equal(c.method, "POST", c.url);
      assert.equal(c.headers?.["Idempotency-Key"], KEY, c.url);
      assert.match(c.headers!["Idempotency-Key"], IDEMPOTENCY_KEY_PATTERN);
    }
  });
  it("a write refuses a missing or malformed key BEFORE sending anything", async () => {
    const { calls, api } = fake();
    for (const bad of ["", "has space", "x".repeat(129), "ký-tự", undefined as unknown as string]) {
      await assert.rejects(() => api.recollect(IDS.case, bad), /INVALID_IDEMPOTENCY_KEY/);
    }
    assert.equal(calls.length, 0);
  });
  it("reads send no Idempotency-Key", async () => {
    const { calls, api } = fake({ items: [], total: 0 });
    await api.listCases({ status: "ASSESSING", limit: 20, offset: 0 });
    await api.getCase(IDS.case);
    await api.listMyCases();
    await api.getMyCase(IDS.case);
    assert.equal(calls.length, 4);
    for (const c of calls) {
      assert.equal(c.method, "GET");
      assert.equal(c.headers, undefined);
    }
  });
});

describe("D1 API client - URLs and bodies", () => {
  it("A1-A18 and B1-B4 hit the documented routes", async () => {
    const { calls, api } = fake({ id: "x" });
    await api.openCase("s1", KEY);
    await api.listCases();
    await api.getCase("c");
    await api.assign("c", { investigatorId: "adm" }, KEY);
    await api.recollect("c", KEY);
    await api.transition("c", { to: "ASSESSING" }, KEY);
    await api.requestMore("c", { note: "n" }, KEY);
    await api.classify("c", "PT_NO_SHOW_CLAIM", KEY);
    await api.addClaim("c", { claimantRole: "PT", text: "t" }, KEY);
    await api.addIssue("c", { finding: "UNDETERMINED" }, KEY);
    await api.addAssessment("c", { claimId: "cl", relevanceNote: "a", verifiabilityNote: "b", consistencyNote: "c", result: "REFUTED", reasoning: "r" }, KEY);
    await api.recordFinding("c", { finding: "INSUFFICIENT_EVIDENCE", reasoning: "r" }, KEY);
    await api.propose("c", {}, KEY);
    await api.decide("c", { result: "REJECTED", reason: "r", conflictOfInterestDeclaredNone: true }, KEY);
    await api.acknowledgeEvidenceChange("c", { note: "n" }, KEY);
    await api.proposePolicyEligibility("c", { result: "EXCEPTION_APPLIES", evidenceIds: ["e"], reasoning: "r" }, KEY);
    await api.approvePolicyEligibility("c", "rev", { reason: "r", conflictOfInterestDeclaredNone: true }, KEY);
    await api.share("c", { statementId: "st", sharedWithRole: "PT", reason: "r" }, KEY);
    await api.listMyCases();
    await api.getMyCase("c");
    await api.submitStatement("c", { text: "t", supplementReason: "s" }, KEY);
    await api.submitEvidence("c", { description: "d", sha256: "b".repeat(64), title: "t", fileName: "f.png" }, KEY);
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url}`),
      [
        "POST /admin/dispute-cases",
        "GET /admin/dispute-cases",
        "GET /admin/dispute-cases/c",
        "POST /admin/dispute-cases/c/assign",
        "POST /admin/dispute-cases/c/recollect",
        "POST /admin/dispute-cases/c/transition",
        "POST /admin/dispute-cases/c/request-more",
        "POST /admin/dispute-cases/c/classify",
        "POST /admin/dispute-cases/c/claims",
        "POST /admin/dispute-cases/c/issues",
        "POST /admin/dispute-cases/c/assessments",
        "POST /admin/dispute-cases/c/findings",
        "POST /admin/dispute-cases/c/proposals",
        "POST /admin/dispute-cases/c/approvals",
        "POST /admin/dispute-cases/c/evidence-change-ack",
        "POST /admin/dispute-cases/c/policy-eligibility",
        "POST /admin/dispute-cases/c/policy-eligibility/rev/approve",
        "POST /admin/dispute-cases/c/shares",
        "GET /dispute-cases",
        "GET /dispute-cases/c",
        "POST /dispute-cases/c/statements",
        "POST /dispute-cases/c/evidence",
      ],
    );
  });
  it("ids in the path are URL-encoded", async () => {
    const { calls, api } = fake({});
    await api.getCase("a/b?c");
    assert.equal(calls[0].url, "/admin/dispute-cases/a%2Fb%3Fc");
  });
  it("bodies carry only schema fields; optional ones are omitted when absent", async () => {
    const { calls, api } = fake({ id: "x" });
    await api.assign("c", {}, KEY);
    await api.assign("c", { investigatorId: "adm-9" }, KEY);
    await api.propose("c", {}, KEY);
    await api.addClaim("c", { claimantRole: "CLIENT", text: "t" }, KEY);
    await api.decide("c", { result: "APPROVED", reason: "r", conflictOfInterestDeclaredNone: true }, KEY);
    assert.deepEqual(calls[0].data, {});
    assert.deepEqual(calls[1].data, { investigatorId: "adm-9" }, "investigatorId is the only target id");
    assert.deepEqual(calls[2].data, {});
    assert.deepEqual(calls[3].data, { claimantRole: "CLIENT", text: "t" });
    assert.deepEqual(calls[4].data, { result: "APPROVED", reason: "r", conflictOfInterestDeclaredNone: true });
  });
  it("list query carries documented filters but never an actor id", async () => {
    const { calls, api } = fake({ items: [], total: 0 });
    await api.listCases({ status: "INTAKE", limit: 10, offset: 30, userId: "x", sessionId: "y" } as never);
    await api.listCases();
    assert.deepEqual(calls[0].params, { status: "INTAKE", limit: 10, offset: 30, sessionId: "y" });
    assert.deepEqual(calls[1].params, {});
  });
  it("NO field the server computes or takes from the token ever reaches the wire, even if a caller passes it", async () => {
    const { calls, api } = fake({ id: "x" });
    const evil = { userId: "u", adminId: "a", approvedBy: "a", amount: 999999, outcome: "COMPLETED", actorId: "a", clientUserId: "c", ptUserId: "p" };
    await api.assign("c", { ...evil } as never, KEY);
    await api.transition("c", { to: "ASSESSING", ...evil } as never, KEY);
    await api.requestMore("c", { note: "n", ...evil } as never, KEY);
    await api.addClaim("c", { claimantRole: "PT", text: "t", ...evil } as never, KEY);
    await api.addIssue("c", { finding: "NOT_LATE", ...evil } as never, KEY);
    await api.addAssessment("c", { claimId: "cl", relevanceNote: "a", verifiabilityNote: "b", consistencyNote: "c", result: "ESTABLISHED", reasoning: "r", ...evil } as never, KEY);
    await api.recordFinding("c", { finding: "VERIFIED_PT_ABSENT", reasoning: "r", ...evil } as never, KEY);
    await api.propose("c", { note: "n", ...evil } as never, KEY);
    await api.decide("c", { result: "APPROVED", reason: "r", conflictOfInterestDeclaredNone: true, ...evil } as never, KEY);
    await api.acknowledgeEvidenceChange("c", { note: "n", ...evil } as never, KEY);
    await api.proposePolicyEligibility("c", { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: ["e"], reasoning: "r", ...evil } as never, KEY);
    await api.approvePolicyEligibility("c", "rev", { reason: "r", conflictOfInterestDeclaredNone: true, ...evil } as never, KEY);
    await api.share("c", { evidenceId: "e", sharedWithRole: "CLIENT", reason: "r", ...evil } as never, KEY);
    await api.submitStatement("c", { text: "t", ...evil } as never, KEY);
    await api.submitEvidence("c", { description: "d", sha256: "a".repeat(64), ...evil } as never, KEY);
    assert.equal(calls.length, 15);
    for (const c of calls) for (const f of FORBIDDEN) assert.ok(!(f in (c.data ?? {})), `${c.url} sent ${f}`);
  });
  it("no exported function signature takes an actor / amount / outcome parameter", () => {
    const src = readFileSync(join(dir, "..", "disputes", "disputeCaseApi.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const f of ["userId", "adminId", "approvedBy", "amount"]) assert.ok(!new RegExp(`\\b${f}\\b`).test(src), `${f} appears in the client`);
    assert.ok(/investigatorId/.test(src));
  });
  it("V2.1 executor routes are exposed, while evidence-file and late-open are not on this client", () => {
    const names = Object.keys(disputeCaseApi);
    for (const n of ["execute", "reconcileExecution", "acknowledgeNeedsHuman"]) assert.ok(names.includes(n), n);
    for (const n of names) assert.ok(!/evidenceFile|lateOpen|downloadFile|readFile/i.test(n), n);
    const src = readFileSync(join(dir, "..", "disputes", "disputeCaseApi.ts"), "utf8");
    assert.match(src, /\/execute/);
    assert.match(src, /reconcile-execution/);
    assert.ok(!/evidence-files|late-open/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
  });
});

describe("D1 API client - A13 discriminated union and the F3 constant", () => {
  it("201 with a proposal -> PROPOSED, without the lying `execution`", async () => {
    const { api } = fake(proposeCreatedRaw, 201);
    const r = await api.propose(IDS.case, {}, KEY);
    assert.equal(r.kind, "PROPOSED");
    if (r.kind === "PROPOSED") {
      assert.equal(r.proposal.id, IDS.proposal);
      assert.equal(r.proposal.outcome, "COMPLETED");
      assert.equal(r.proposal.caseStatus, "AWAITING_APPROVAL");
      assert.equal(r.proposal.executionBlockedReason, null);
      assert.ok(!("execution" in r.proposal));
    }
  });
  it("200 with NO proposal (policyPending) -> POLICY_PENDING", async () => {
    const { api } = fake(proposePolicyPendingRaw, 200);
    const r = await api.propose(IDS.case, {}, KEY);
    assert.equal(r.kind, "POLICY_PENDING");
    if (r.kind === "POLICY_PENDING") {
      assert.equal(r.policyPending.blocked, "CANCELLED_BLOCKED_BY_D77");
      assert.equal(r.policyPending.caseStatus, "POLICY_PENDING");
      assert.ok(!("id" in r.policyPending));
    }
  });
  it("a D77-blocked real proposal keeps executionBlockedReason", async () => {
    const { api } = fake({ ...proposeCreatedRaw, executionBlockedReason: "D77_COMBINATION_UNRESOLVED" }, 201);
    const r = await api.propose(IDS.case, {}, KEY);
    assert.equal(r.kind === "PROPOSED" && r.proposal.executionBlockedReason, "D77_COMBINATION_UNRESOLVED");
  });
  it("decide keeps the real executionBlockedReason and drops the constant `execution`", async () => {
    const { api } = fake(decideApprovedRaw);
    const r = await api.decide(IDS.case, { result: "APPROVED", reason: "r", conflictOfInterestDeclaredNone: true }, KEY);
    assert.equal(r.caseStatus, "DECISION_APPROVED");
    assert.equal(r.executionBlockedReason, "D77_COMBINATION_UNRESOLVED");
    assert.ok(!("execution" in r));
    const rejected = await fake({ approvalId: "a", result: "REJECTED", caseStatus: "ASSESSING", outcome: "COMPLETED" }).api.decide(IDS.case, { result: "REJECTED", reason: "r", conflictOfInterestDeclaredNone: true }, KEY);
    assert.ok(!("executionBlockedReason" in rejected));
  });
  it("the fixture of a real A3 answer carries the lie, the types do not", () => {
    const d = detailFixture() as unknown as { proposals: Array<Record<string, unknown>> };
    assert.equal(d.proposals[0].execution, "BLOCKED: SLICE_2_NOT_ENABLED");
    const src = readFileSync(join(dir, "..", "disputes", "disputeCaseTypes.ts"), "utf8");
    assert.ok(!/BLOCKED: SLICE_2_NOT_ENABLED/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  });
});

describe("D1 API client - C1 / C3 are the unchanged adminService functions", () => {
  it("re-exported by reference", () => {
    assert.equal(listDisputedSessions, adminService.listDisputedSessions);
    assert.equal(resolveSessionDispute, adminService.resolveSessionDispute);
  });
});
