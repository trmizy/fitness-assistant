/**
 * DISPUTE CASE slice 1 - the PURE rules and the read-only financial view (no database). Evidence label: TEST FIXTURE (a stubbed payment client and
 * a stubbed settlement query at their boundary) + CODE AUDIT of the pure functions. Nothing here is end-to-end.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paymentClient } from "../clients/payment.client";
import { canonicalJson, contentHashOf, sha256Hex } from "../services/dispute-case/canonical";
import { buildFinancialView, hasLateArrivalStep, partyFinancialView } from "../services/dispute-case/financial";
import {
  CLASSIFIABLE_TYPES,
  GROUP_LABEL_VI,
  TRANSITIONS,
  VERIFICATION_REQUIRED_LABEL_VI,
  canTransition,
  caseF3Kind,
  effectiveVerificationStatus,
  f3KindOf,
  isPartySubmitted,
  shareRefusalReason,
  canTransitionManually,
  changeAcknowledged,
  checkApprover,
  classifyFinancialItem,
  deriveCaseType,
  diffAgainstSnapshot,
  evidenceVisibleToParty,
  financialKeysFor,
  groupOf,
  outcomeForFinding,
  partyRoleOf,
  statementVisibleToParty,
  worstGroup,
  type CaseStatus,
  type FindingKind,
} from "../services/dispute-case/rules";
import { approvalBody, classifyBody, partyEvidenceBody, proposalBody } from "../services/dispute-case/schemas";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

// ── finding -> outcome ─────────────────────────────────────────────────────────────────────────────────────────────

test("finding -> outcome is the fixed server mapping; INSUFFICIENT_EVIDENCE and NOT_A_DISPUTE produce no proposal", () => {
  const table: Record<FindingKind, string | null> = {
    VERIFIED_DELIVERED: "COMPLETED",
    VERIFIED_CLIENT_ABSENT: "COMPLETED",
    VERIFIED_PT_ABSENT: "PT_NO_SHOW_CONFIRMED",
    VERIFIED_NOT_DELIVERED_NO_FAULT: "CANCELLED",
    INSUFFICIENT_EVIDENCE: null,
    NOT_A_DISPUTE: null,
  };
  for (const [finding, outcome] of Object.entries(table)) assert.equal(outcomeForFinding(finding as FindingKind), outcome, finding);
});

test("a proposal body cannot carry an outcome or an amount (strict schema)", () => {
  assert.equal(proposalBody.safeParse({}).success, true);
  assert.equal(proposalBody.safeParse({ note: "ok" }).success, true);
  assert.equal(proposalBody.safeParse({ outcome: "COMPLETED" }).success, false);
  assert.equal(proposalBody.safeParse({ amount: 1000 }).success, false);
  assert.equal(approvalBody.safeParse({ result: "APPROVED", reason: "x", conflictOfInterestDeclaredNone: true, approverId: "someone-else" }).success, false);
});

// ── transition table ───────────────────────────────────────────────────────────────────────────────────────────────

test("transition table: terminal states have no exits; the happy path is allowed; shortcuts are not", () => {
  assert.deepEqual(TRANSITIONS.DECISION_APPROVED, []);
  assert.deepEqual(TRANSITIONS.REJECTED_INTAKE, []);
  const path: CaseStatus[] = ["INTAKE", "COLLECTING", "AWAITING_PARTIES", "ASSESSING", "FINDING_RECORDED", "PROPOSED", "AWAITING_APPROVAL", "DECISION_APPROVED"];
  for (let i = 0; i < path.length - 1; i++) assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]}`);
  assert.equal(canTransition("INTAKE", "DECISION_APPROVED"), false);
  assert.equal(canTransition("COLLECTING", "FINDING_RECORDED"), false);
  assert.equal(canTransition("FINDING_RECORDED", "DECISION_APPROVED"), false);
  assert.equal(canTransition("AWAITING_APPROVAL", "ASSESSING"), true, "a rejection goes back to ASSESSING");
  assert.equal(canTransition("DECISION_APPROVED", "ASSESSING"), false);
  assert.equal(canTransition("REJECTED_INTAKE", "COLLECTING"), false);
  assert.equal(canTransition("FINDING_RECORDED", "POLICY_PENDING"), true);
});

test("the generic transition endpoint cannot reach a state that only an action earns", () => {
  for (const to of ["FINDING_RECORDED", "POLICY_PENDING", "PROPOSED", "AWAITING_APPROVAL", "DECISION_APPROVED"] as CaseStatus[]) {
    for (const from of Object.keys(TRANSITIONS) as CaseStatus[]) assert.equal(canTransitionManually(from, to), false, `${from} -> ${to}`);
  }
  assert.equal(canTransitionManually("AWAITING_APPROVAL", "ASSESSING"), false, "only an approver's rejection leaves AWAITING_APPROVAL");
  assert.equal(canTransitionManually("INTAKE", "REJECTED_INTAKE"), true);
  assert.equal(canTransitionManually("COLLECTING", "REJECTED_INTAKE"), false, "REJECTED_INTAKE only from INTAKE");
  assert.equal(canTransitionManually("COLLECTING", "AWAITING_PARTIES"), true);
});

test("case type: PT_NO_SHOW_REPORTED -> PT_NO_SHOW_CLAIM; DISPUTED follows disputeType; a NULL disputeType is the provisional LEGACY_UNCLASSIFIED, never a guessed real type", () => {
  assert.equal(deriveCaseType("PT_NO_SHOW_REPORTED", null), "PT_NO_SHOW_CLAIM");
  assert.equal(deriveCaseType("DISPUTED", "DELIVERY_DISPUTE"), "PT_DELIVERY");
  assert.equal(deriveCaseType("DISPUTED", "PT_NO_SHOW_CLAIM"), "PT_NO_SHOW_CLAIM");
  assert.equal(deriveCaseType("DISPUTED", "CLIENT_NO_SHOW_CLAIM"), "PT_CLIENT_NO_SHOW_CLAIM");
  assert.equal(deriveCaseType("DISPUTED", null), "LEGACY_UNCLASSIFIED");
  assert.equal(deriveCaseType("DISPUTED", undefined), "LEGACY_UNCLASSIFIED");
  assert.equal(deriveCaseType("DISPUTED", "SOMETHING_NEW"), null, "an unknown NON-null value is still refused");
  assert.equal(deriveCaseType("COMPLETED", "DELIVERY_DISPUTE"), null);
});

// ── financial classification ───────────────────────────────────────────────────────────────────────────────────────

test("financial classification: every settlement/ledger/obligation combination lands in its design state", () => {
  const found = (status?: string) => ({ status: "FOUND" as const, obligation: status ? { status } : null });
  const cases: Array<[string, any, string, string]> = [
    ["PENDING", { status: "ABSENT" }, "LEDGER_PENDING", "F3"],
    ["PROCESSING", { status: "ABSENT" }, "LEDGER_PENDING", "F3"],
    ["FAILED", { status: "UNAVAILABLE" }, "LEDGER_PENDING", "F3"],
    ["NEEDS_HUMAN", { status: "ABSENT" }, "NEEDS_RECONCILIATION", "F3"],
    ["CONFLICT", found(), "NEEDS_RECONCILIATION", "F3"],
    ["UNCONFIRMED", { status: "ABSENT" }, "NEEDS_RECONCILIATION", "F3"],
    ["SETTLED", found(), "LEDGER_POSTED_FULL", "F1"],
    ["SETTLED", found("PAID_VERIFIED"), "OBLIGATION_PAID_VERIFIED", "F1"],
    ["SETTLED", found("WAIVED"), "OBLIGATION_WAIVED", "F2"],
    ["SETTLED", found("RESOLVED_OTHER"), "OBLIGATION_RESOLVED_OTHER", "F2"],
    ["SETTLED", found("OPEN"), "LEDGER_POSTED_PARTIAL", "F3"],
    ["SETTLED", found("UNDER_REVIEW"), "LEDGER_POSTED_PARTIAL", "F3"],
    ["SETTLED", found("APPROVED_FOR_PAYMENT"), "OBLIGATION_IN_PAYMENT", "F3"],
    ["SETTLED", found("AWAITING_EVIDENCE"), "OBLIGATION_IN_PAYMENT", "F3"],
    ["SETTLED", found("RESOLVED"), "LEGACY_NEEDS_VERIFICATION", "F3"], // historical status: not an open debt, not verified as paid
    ["SETTLED", found("PAID_EXTERNALLY"), "LEGACY_NEEDS_VERIFICATION", "F3"],
    ["SETTLED", found("SOME_FUTURE_STATUS"), "LEGACY_NEEDS_VERIFICATION", "F3"],
    ["SETTLED", { status: "ABSENT" }, "NEEDS_RECONCILIATION", "F3"], // settled here, ledger has no record of the key
    ["SETTLED", { status: "UNAVAILABLE" }, "UNAVAILABLE", "UNAVAILABLE"],
  ];
  for (const [settlement, ledger, state, group] of cases) {
    const s = classifyFinancialItem(settlement, ledger);
    assert.equal(s, state, `${settlement}/${JSON.stringify(ledger)}`);
    assert.equal(groupOf(s), group);
  }
});

test("worst-of over ALL items: any F3 -> F3 (a WAIVED item plus an OPEN item is F3); unreadable ledger -> UNAVAILABLE, never F1/F2", () => {
  assert.equal(worstGroup(["OBLIGATION_WAIVED", "LEDGER_POSTED_PARTIAL"]), "F3");
  assert.equal(worstGroup(["LEDGER_POSTED_FULL", "OBLIGATION_WAIVED"]), "F2");
  assert.equal(worstGroup(["LEDGER_POSTED_FULL", "OBLIGATION_PAID_VERIFIED"]), "F1");
  assert.equal(worstGroup(["LEDGER_POSTED_FULL", "UNAVAILABLE"]), "UNAVAILABLE");
  assert.equal(worstGroup(["OBLIGATION_WAIVED", "UNAVAILABLE"]), "UNAVAILABLE");
  assert.equal(worstGroup(["UNAVAILABLE", "NEEDS_RECONCILIATION"]), "F3", "F3 is already the worst a known item can be");
  assert.equal(worstGroup([]), "NO_RECORDED_SETTLEMENT");
  assert.equal(worstGroup(["LEGACY_NEEDS_VERIFICATION", "LEDGER_POSTED_FULL"]), "F3", "a historical record keeps the case in the F3 queue");
});

function fakeDb(rows: Array<Record<string, unknown>>) {
  return { sessionSettlement: { findMany: async () => rows, findUnique: async ({ where }: any) => rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null } } as any;
}
const row = (key: string, status: string, over: Record<string, unknown> = {}) => ({ id: `id-${key}`, kind: "SESSION_RELEASE", idempotencyKey: key, status, sessionId: "S1", ...over });
const record = (key: string, obligation?: { status: string }) => ({
  key,
  kind: "RELEASE_SESSION",
  transactionId: "t1",
  result: { owed: "250000.00", paid: "100000.00", unpaid: "150000.00" },
  createdAt: "2026-10-01T00:00:00.000Z",
  fingerprinted: true,
  ...(obligation ? { obligation: { id: "o1", owed: "250000.00", paid: "100000.00", unpaid: "150000.00", ...obligation } } : {}),
});

test("financial view: a WAIVED obligation plus an OPEN one is F3; amounts are passed through exactly as the ledger reports them", async () => {
  const restore = patch(paymentClient, "lookupLedgerOperation", async (key: string) =>
    key.startsWith("PT_NO_SHOW") ? record(key, { status: "WAIVED" }) : record(key, { status: "OPEN" }),
  );
  try {
    const view = await buildFinancialView(fakeDb([row("PT_NO_SHOW:S1", "SETTLED"), row("SESSION_RELEASE:S1", "SETTLED")]), "S1");
    assert.equal(view.group, "F3");
    assert.deepEqual(view.items.map((i) => i.state), ["OBLIGATION_WAIVED", "LEDGER_POSTED_PARTIAL"]);
    const open = view.items[1].ledger as any;
    assert.equal(open.obligation.unpaid, "150000.00", "ledger amount untouched (string, not a number)");
    assert.equal(view.items[0].resolutionReason, undefined);
    assert.equal(view.derived, true);
  } finally {
    restore();
  }
});

test("financial view: RESOLVED_OTHER is F2 and says its reason is not available from the lookup (nothing invented)", async () => {
  const restore = patch(paymentClient, "lookupLedgerOperation", async (key: string) => record(key, { status: "RESOLVED_OTHER" }));
  try {
    const view = await buildFinancialView(fakeDb([row("SESSION_RELEASE:S1", "SETTLED")]), "S1");
    assert.equal(view.group, "F2");
    assert.equal(view.items[0].resolutionReason?.available, false);
  } finally {
    restore();
  }
});

test("financial view: ledger unreachable -> UNAVAILABLE (never 0); a not-yet-settled row stays F3 whatever the ledger says", async () => {
  const restore = patch(paymentClient, "lookupLedgerOperation", async () => {
    throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  });
  try {
    const down = await buildFinancialView(fakeDb([row("SESSION_RELEASE:S1", "SETTLED")]), "S1");
    assert.equal(down.group, "UNAVAILABLE");
    assert.equal(down.items[0].state, "UNAVAILABLE");
    assert.equal((down.items[0].ledger as any).status, "UNAVAILABLE");
    const pending = await buildFinancialView(fakeDb([row("SESSION_RELEASE:S1", "PENDING"), row("PT_NO_SHOW:S1", "SETTLED")]), "S1");
    assert.equal(pending.group, "F3");
    const none = await buildFinancialView(fakeDb([]), "S1");
    assert.equal(none.group, "NO_RECORDED_SETTLEMENT");
    assert.notEqual(none.group, "NO_MONEY_EFFECT");
    assert.equal(none.groupLabel, "Chưa có bước quyết toán được ghi nhận");
    assert.equal(none.items.length, 0);
  } finally {
    restore();
  }
});

test("a party gets only the group label: no keys, no amounts, no split", async () => {
  const restore = patch(paymentClient, "lookupLedgerOperation", async (key: string) => record(key, { status: "OPEN" }));
  try {
    const view = await buildFinancialView(fakeDb([row("SESSION_RELEASE:S1", "SETTLED")]), "S1");
    const party = partyFinancialView(view);
    assert.deepEqual(Object.keys(party).sort(), ["group", "groupLabel"]);
    assert.doesNotMatch(JSON.stringify(party), /150000|SESSION_RELEASE|obligation/);
  } finally {
    restore();
  }
});

test("the financial view reads exactly the four session-level keys", () => {
  assert.deepEqual(financialKeysFor("X"), ["PT_NO_SHOW:X", "SESSION_RELEASE:X", "PT_LATE_ARRIVAL:X", "UNRESOLVED_SESSION:X"]);
});

test("B-1 probe: a settlement row answers without the ledger; an unreadable ledger with no row is 'unknown', never 'no'", async () => {
  let asked = 0;
  const restore = patch(paymentClient, "lookupLedgerOperation", async () => {
    asked += 1;
    throw new Error("down");
  });
  try {
    assert.deepEqual(await hasLateArrivalStep(fakeDb([row("PT_LATE_ARRIVAL:S1", "FAILED")]), "S1"), { exists: true });
    assert.equal(asked, 0);
    assert.deepEqual(await hasLateArrivalStep(fakeDb([]), "S1"), { unknown: true });
  } finally {
    restore();
  }
  const restoreNull = patch(paymentClient, "lookupLedgerOperation", async () => null);
  try {
    assert.deepEqual(await hasLateArrivalStep(fakeDb([]), "S1"), { exists: false });
  } finally {
    restoreNull();
  }
  const restoreFound = patch(paymentClient, "lookupLedgerOperation", async (k: string) => record(k));
  try {
    assert.deepEqual(await hasLateArrivalStep(fakeDb([]), "S1"), { exists: true });
  } finally {
    restoreFound();
  }
});

// ── canonical hash ─────────────────────────────────────────────────────────────────────────────────────────────────

test("canonical hash is stable: key order, undefined fields, Date/Decimal-like values and a JSON round trip do not change it", () => {
  const a = { b: 1, a: { y: [1, 2, { q: null, p: "x" }], x: undefined }, d: new Date("2026-10-01T00:00:00.000Z"), money: { toJSON: () => "5000000.00" } };
  const b = { money: "5000000.00", d: "2026-10-01T00:00:00.000Z", a: { y: [1, 2, { p: "x", q: null }] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(contentHashOf(a), contentHashOf(JSON.parse(JSON.stringify(a))));
  assert.equal(contentHashOf(a), sha256Hex(canonicalJson(b)));
  assert.match(contentHashOf(a), /^[0-9a-f]{64}$/);
  assert.notEqual(contentHashOf({ a: 1 }), contentHashOf({ a: 2 }));
  assert.notEqual(contentHashOf({ a: [1, 2] }), contentHashOf({ a: [2, 1] }), "array order is content");
});

// ── four eyes ──────────────────────────────────────────────────────────────────────────────────────────────────────

const base = { approverId: "A2", approverRole: "ADMIN", proposerId: "A1", investigatorId: "A1", clientUserId: "C", ptUserId: "P", conflictOfInterestDeclaredNone: true };
test("approver check: ADMIN, not the proposer, not the investigator, not a party, declaration true", () => {
  assert.deepEqual(checkApprover(base), { ok: true });
  assert.deepEqual({ ...checkApprover({ ...base, approverId: "A1" }) }, { ok: false, status: 403, code: "SELF_APPROVAL_FORBIDDEN", message: "Người đề xuất không được tự duyệt đề xuất của mình" });
  const inv = checkApprover({ ...base, proposerId: "A9", investigatorId: "A2" });
  assert.equal(inv.ok === false && inv.code, "SELF_APPROVAL_FORBIDDEN");
  const client = checkApprover({ ...base, approverId: "C" });
  assert.equal(client.ok === false && client.code, "CONFLICT_OF_INTEREST");
  const pt = checkApprover({ ...base, approverId: "P" });
  assert.equal(pt.ok === false && pt.code, "CONFLICT_OF_INTEREST");
  const decl = checkApprover({ ...base, conflictOfInterestDeclaredNone: false });
  assert.equal(decl.ok === false && decl.code, "CONFLICT_OF_INTEREST");
  const role = checkApprover({ ...base, approverRole: "CUSTOMER" });
  assert.equal(role.ok === false && role.code, "ADMIN_ONLY");
});

// ── evidence change guard ──────────────────────────────────────────────────────────────────────────────────────────

test("evidence change guard: a row written after the snapshot is a change; it needs the approver's flag AND an investigator ACK at/after it", () => {
  const t0 = new Date("2026-10-01T10:00:00Z");
  const t1 = new Date("2026-10-01T11:00:00Z");
  const snapshot = [{ id: "e1", hash: "h1", version: 1 }];
  const same = diffAgainstSnapshot({ snapshot, current: [{ id: "e1", hash: "h1", createdAt: t0 }], staleLive: [] });
  assert.equal(same.changed, false);
  assert.equal(changeAcknowledged(same, false, []), true);

  const added = diffAgainstSnapshot({ snapshot, current: [{ id: "e1", hash: "h1", createdAt: t0 }, { id: "e2", hash: "h2", createdAt: t1 }], staleLive: [] });
  assert.equal(added.changed, true);
  assert.deepEqual(added.newIds, ["e2"]);
  assert.equal(changeAcknowledged(added, false, [new Date(t1.getTime() + 1000)]), false, "approver flag missing");
  assert.equal(changeAcknowledged(added, true, []), false, "no investigator ACK");
  assert.equal(changeAcknowledged(added, true, [new Date(t1.getTime() - 1000)]), false, "ACK older than the change");
  assert.equal(changeAcknowledged(added, true, [t1]), true);
  assert.equal(changeAcknowledged(added, true, [new Date(t1.getTime() + 1000)]), true);

  const stale = diffAgainstSnapshot({ snapshot, current: [{ id: "e1", hash: "h1", createdAt: t0 }], staleLive: ["user-service.sessions#SESSION_ROW"] });
  assert.equal(stale.changed, true);
  assert.equal(changeAcknowledged(stale, true, [new Date(t1.getTime() + 1000)]), false, "a live change nobody re-collected cannot be acknowledged");

  const mutated = diffAgainstSnapshot({ snapshot, current: [{ id: "e1", hash: "OTHER", createdAt: t0 }], staleLive: [] });
  assert.equal(mutated.changed, true);
});

// ── party redaction ────────────────────────────────────────────────────────────────────────────────────────────────

test("party redaction: own items, NORMAL system evidence and shared items are visible; the other party's unshared items and SENSITIVE system evidence are not", () => {
  const kase = { clientUserId: "C", ptUserId: "P" };
  assert.equal(partyRoleOf("C", kase), "CLIENT");
  assert.equal(partyRoleOf("P", kase), "PT");
  assert.equal(partyRoleOf("A1", kase), null);
  const client = { userId: "C", role: "CLIENT" as const };
  const pt = { userId: "P", role: "PT" as const };

  const system = { id: "s1", sensitivity: "NORMAL", submittedBy: null, submittedRole: null };
  const sensitive = { id: "s2", sensitivity: "SENSITIVE", submittedBy: null, submittedRole: null };
  const clientDoc = { id: "d1", sensitivity: "NORMAL", submittedBy: "C", submittedRole: "CLIENT" };
  const ptDoc = { id: "d2", sensitivity: "NORMAL", submittedBy: "P", submittedRole: "PT" };
  const adminDoc = { id: "d3", sensitivity: "NORMAL", submittedBy: "A1", submittedRole: "ADMIN" };

  for (const v of [client, pt]) {
    assert.equal(evidenceVisibleToParty(system, v, []), true);
    assert.equal(evidenceVisibleToParty(sensitive, v, []), false);
    assert.equal(evidenceVisibleToParty(adminDoc, v, []), false);
  }
  assert.equal(evidenceVisibleToParty(clientDoc, client, []), true);
  assert.equal(evidenceVisibleToParty(clientDoc, pt, []), false);
  assert.equal(evidenceVisibleToParty(ptDoc, client, []), false);
  const shared = [{ evidenceId: "d2", statementId: null, sharedWithRole: "CLIENT" }];
  assert.equal(evidenceVisibleToParty(ptDoc, client, shared), false, "a party-submitted row is NEVER visible to the other side, even with a share row");
  assert.equal(evidenceVisibleToParty(clientDoc, pt, shared), false);

  const clientStmt = { id: "t1", authorUserId: "C", partyRole: "CLIENT" };
  const ptStmt = { id: "t2", authorUserId: "P", partyRole: "PT" };
  assert.equal(statementVisibleToParty(clientStmt, client, []), true);
  assert.equal(statementVisibleToParty(ptStmt, client, []), false);
  assert.equal(statementVisibleToParty(ptStmt, client, [{ evidenceId: null, statementId: "t2", sharedWithRole: "CLIENT" }]), true);
});

// ── Vietnamese user-facing messages ────────────────────────────────────────────────────────────────────────────────

test("user-facing refusals of the dispute-case service are Vietnamese (no English message literal in caseError calls)", () => {
  const dir = join(__dirname, "..", "services", "dispute-case");
  const ENGLISH = /\b(not found|permission|forbidden|required|cannot|is not|must|invalid|already|unauthorized)\b/i;
  for (const f of ["dispute-case.service.ts", "errors.ts", "rules.ts", "schemas.ts"]) {
    const src = readFileSync(join(dir, f), "utf8");
    const messages = [...src.matchAll(/caseError\(\s*\d+\s*,\s*"[A-Z0-9_]+"\s*,\s*"([^"]+)"/g)].map((m) => m[1]);
    if (f === "dispute-case.service.ts") assert.ok(messages.length > 20, "the scan found the messages");
    for (const m of messages) assert.doesNotMatch(m, ENGLISH, `${f}: ${m}`);
    const rulesMsgs = [...src.matchAll(/message:\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const m of rulesMsgs) assert.doesNotMatch(m, ENGLISH, `${f}: ${m}`);
  }
});

// ── Hardening: self-submitted evidence ─────────────────────────────────────────────────────────────────────────────

test("hardening P0: party-submitted evidence is unshareable; so is anything unverified or not NORMAL; only server/system NORMAL evidence may be shared", () => {
  const ok = { id: "x", sensitivity: "NORMAL", submittedBy: null, submittedRole: null, verificationStatus: "NOT_APPLICABLE" };
  assert.equal(shareRefusalReason(ok), null);
  assert.equal(shareRefusalReason({ ...ok, verificationStatus: "SERVER_VERIFIED" }), null);
  assert.equal(shareRefusalReason({ ...ok, submittedBy: "C", submittedRole: "CLIENT", sensitivity: "RESTRICTED", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" }), "PARTY_SUBMITTED");
  assert.equal(shareRefusalReason({ ...ok, submittedBy: "P", submittedRole: "PT" }), "PARTY_SUBMITTED", "by role alone, whatever the other columns say");
  assert.equal(shareRefusalReason({ ...ok, verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" }), "UNVERIFIED");
  assert.equal(shareRefusalReason({ ...ok, sensitivity: "SENSITIVE" }), "NOT_NORMAL_SENSITIVITY");
  assert.equal(shareRefusalReason({ ...ok, sensitivity: "RESTRICTED" }), "NOT_NORMAL_SENSITIVITY");
  assert.equal(effectiveVerificationStatus({ submittedRole: "CLIENT", verificationStatus: "NOT_APPLICABLE" }), "CLIENT_CLAIMED_UNVERIFIED", "an old row is treated as unverified too");
  assert.equal(effectiveVerificationStatus({ submittedRole: null, verificationStatus: undefined }), "NOT_APPLICABLE");
  assert.equal(isPartySubmitted({ submittedRole: "ADMIN" }), false);
});

test("hardening P0: the other side never sees a self-submitted row (payload, metadata, hash) - not even through a share row; the author always does; RESTRICTED system rows stay hidden", () => {
  const client = { userId: "C", role: "CLIENT" as const };
  const pt = { userId: "P", role: "PT" as const };
  const doc = { id: "d", sensitivity: "RESTRICTED", submittedBy: "C", submittedRole: "CLIENT", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" };
  const forcedShare = [{ evidenceId: "d", statementId: null, sharedWithRole: "PT" }];
  assert.equal(evidenceVisibleToParty(doc, client, []), true);
  assert.equal(evidenceVisibleToParty(doc, pt, []), false);
  assert.equal(evidenceVisibleToParty(doc, pt, forcedShare), false);
  const sysRestricted = { id: "s", sensitivity: "RESTRICTED", submittedBy: null, submittedRole: null, verificationStatus: "NOT_APPLICABLE" };
  assert.equal(evidenceVisibleToParty(sysRestricted, client, []), false);
  const adminSharedNormal = { id: "a", sensitivity: "NORMAL", submittedBy: "A1", submittedRole: "ADMIN", verificationStatus: "NOT_APPLICABLE" };
  assert.equal(evidenceVisibleToParty(adminSharedNormal, pt, []), false);
  assert.equal(evidenceVisibleToParty(adminSharedNormal, pt, [{ evidenceId: "a", statementId: null, sharedWithRole: "PT" }]), true);
});

test("hardening P0: a party cannot choose sensitivity / verificationStatus - the strict body refuses them", () => {
  const good = { description: "Ảnh", sha256: "a".repeat(64) };
  assert.equal(partyEvidenceBody.safeParse(good).success, true);
  for (const extra of [{ sensitivity: "NORMAL" }, { sensitivity: "RESTRICTED" }, { verificationStatus: "SERVER_VERIFIED" }, { submittedRole: "ADMIN" }, { hashStatus: "SERVER_VERIFIED" }]) {
    assert.equal(partyEvidenceBody.safeParse({ ...good, ...extra }).success, false, JSON.stringify(extra));
  }
});

// ── Hardening: legacy obligation status, no-settlement, classification ─────────────────────────────────────────────

test("hardening 5B: a historical obligation (RESOLVED / PAID_EXTERNALLY / unknown) is LEGACY_NEEDS_VERIFICATION: F3 queue, f3Kind VERIFICATION_REQUIRED, own label", async () => {
  assert.equal(f3KindOf("LEGACY_NEEDS_VERIFICATION"), "VERIFICATION_REQUIRED");
  assert.equal(f3KindOf("LEDGER_POSTED_PARTIAL"), "OUTSTANDING");
  assert.equal(f3KindOf("LEDGER_PENDING"), "OUTSTANDING");
  assert.equal(f3KindOf("OBLIGATION_WAIVED"), undefined);
  assert.equal(caseF3Kind(["LEGACY_NEEDS_VERIFICATION"]), "VERIFICATION_REQUIRED");
  assert.equal(caseF3Kind(["LEGACY_NEEDS_VERIFICATION", "LEDGER_POSTED_PARTIAL"]), "OUTSTANDING");
  assert.equal(caseF3Kind(["LEDGER_POSTED_FULL"]), undefined);
  const restore = patch(paymentClient, "lookupLedgerOperation", async (key: string) => record(key, { status: key.startsWith("PT_NO_SHOW") ? "RESOLVED" : "PAID_EXTERNALLY" }));
  try {
    const only = await buildFinancialView(fakeDb([row("PT_NO_SHOW:S1", "SETTLED"), row("SESSION_RELEASE:S1", "SETTLED")]), "S1");
    assert.equal(only.group, "F3");
    assert.equal(only.f3Kind, "VERIFICATION_REQUIRED");
    assert.deepEqual(only.items.map((i) => [i.state, i.group, i.f3Kind]), [["LEGACY_NEEDS_VERIFICATION", "F3", "VERIFICATION_REQUIRED"], ["LEGACY_NEEDS_VERIFICATION", "F3", "VERIFICATION_REQUIRED"]]);
    assert.equal(only.items[0].label, VERIFICATION_REQUIRED_LABEL_VI);
    assert.equal(only.groupLabel, "Cần xác minh — không phải nợ đang mở, cũng chưa xác minh đã trả");
    assert.equal(partyFinancialView(only).groupLabel, only.groupLabel);
    assert.deepEqual(Object.keys(partyFinancialView(only)).sort(), ["group", "groupLabel"]);
    assert.notEqual(only.groupLabel, GROUP_LABEL_VI.F3, "it is not presented as 'still owed'");
    // mixed with a real open debt: OUTSTANDING and the usual F3 label
    const restoreMixed = patch(paymentClient, "lookupLedgerOperation", async (key: string) => record(key, { status: key.startsWith("PT_NO_SHOW") ? "RESOLVED" : "OPEN" }));
    try {
      const mixed = await buildFinancialView(fakeDb([row("PT_NO_SHOW:S1", "SETTLED"), row("SESSION_RELEASE:S1", "SETTLED")]), "S1");
      assert.equal(mixed.group, "F3");
      assert.equal(mixed.f3Kind, "OUTSTANDING");
      assert.equal(mixed.groupLabel, GROUP_LABEL_VI.F3);
      assert.deepEqual(mixed.items.map((i) => i.f3Kind), ["VERIFICATION_REQUIRED", "OUTSTANDING"]);
    } finally {
      restoreMixed();
    }
  } finally {
    restore();
  }
});

test("hardening 5C: no settlement row -> NO_RECORDED_SETTLEMENT with its own label; never NO_MONEY_EFFECT or an F-group", async () => {
  const none = await buildFinancialView(fakeDb([]), "S1");
  assert.equal(none.group, "NO_RECORDED_SETTLEMENT");
  assert.equal(none.groupLabel, GROUP_LABEL_VI.NO_RECORDED_SETTLEMENT);
  assert.equal(JSON.stringify(none).includes("NO_MONEY_EFFECT"), false);
  assert.equal(none.f3Kind, undefined);
  assert.deepEqual(partyFinancialView(none), { group: "NO_RECORDED_SETTLEMENT", groupLabel: "Chưa có bước quyết toán được ghi nhận" });
});

test("hardening 5A: classify accepts only the three real types", () => {
  assert.deepEqual([...CLASSIFIABLE_TYPES], ["PT_DELIVERY", "PT_CLIENT_NO_SHOW_CLAIM", "PT_NO_SHOW_CLAIM"]);
  for (const t of CLASSIFIABLE_TYPES) assert.equal(classifyBody.safeParse({ type: t }).success, true);
  for (const bad of ["LEGACY_UNCLASSIFIED", "SOMETHING", ""]) assert.equal(classifyBody.safeParse({ type: bad }).success, false, bad);
  assert.equal(classifyBody.safeParse({ type: "PT_DELIVERY", sessionId: "x" }).success, false, "strict");
});
