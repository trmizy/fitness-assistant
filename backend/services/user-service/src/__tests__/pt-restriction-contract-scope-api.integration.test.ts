/**
 * CONTRACT-scope PT restriction, part 3 — the HTTP surface and the database rules: who may call the
 * admin endpoints, request/response/code of each, idempotency, validation, what the PT / a client /
 * another PT may read, the internal per-contract answer the future gym check-in must use, and the
 * constraints the migration adds.
 *
 * Evidence label: BACKEND INTEGRATION. The real user-service Express app runs on a random port against
 * the isolated gymcoach_user_test database; auth-service identities are a token table (TEST FIXTURE),
 * payment-service and the notification push are stubbed at the client boundary (TEST FIXTURE).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-restriction-contract-scope-api.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { openEpisode, ptRestrictionService, syncPtSuspendedFlag } from "../services/pt-restriction.service";
import { cleanup, makeContract, makePt, skip, stubs } from "./pt-restriction.test-helpers";
import { ADMIN, SERVICE_SECRET, makeAn, startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";

let app: App;
test.before(async () => {
  app = await startApp();
});
test.after(async () => {
  await app.close();
});

const body = (extra: Record<string, unknown> = {}) => ({ category: "COMPLAINT_REVIEW", reason: "khiếu nại nội bộ", publicReason: "Đang xem xét một phản ánh", ...extra });

test("authorization: PT, client, gym owner and another PT cannot call any of the contract-scope admin endpoints; no token is 401; nothing is written; the acting admin is the verified token, never the body", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const pt2 = await makePt();
  const adminUserId = randomUUID();
  const toks = {
    admin: tokenFor(adminUserId, "ADMIN"),
    pt: tokenFor(pt, "PT"),
    pt2: tokenFor(pt2, "PT"),
    client: tokenFor(c.binh.clientUserId, "CUSTOMER"),
    owner: tokenFor(randomUUID(), "GYM_OWNER"),
  };
  const s = stubs();
  try {
    const calls: Array<[string, string, unknown?]> = [
      ["POST", `/admin/pts/${pt}/contracts/${c.binh.id}/restrict`, body()],
      ["POST", `/admin/pts/${pt}/contracts/${c.binh.id}/lift-restriction`, { reason: "x" }],
      ["POST", `/admin/pts/${pt}/restrictions/change-scope`, { to: "ACCOUNT", contractId: c.binh.id, reason: "x" }],
      ["POST", `/admin/pts/${pt}/restrictions/justify`, { reason: "x", contractId: c.binh.id }],
      ["GET", `/admin/pts/${pt}/restrictions`],
      ["GET", "/admin/pts/suspended?scope=CONTRACT"],
    ];
    for (const tok of [toks.pt, toks.pt2, toks.client, toks.owner]) {
      for (const [m, p, b] of calls) assert.equal((await app.call(m, p, tok, b)).status, 403, `${m} ${p}`);
    }
    for (const [m, p, b] of calls) assert.equal((await app.call(m, p, null, b)).status, 401, `${m} ${p} without a token`);
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt } }), 0, "nothing was written by the refused calls");

    // the admin: the actor is the token's id, a forged adminId in the body is ignored
    const adminId = adminUserId;
    const r = await app.call("POST", `/admin/pts/${pt}/contracts/${c.binh.id}/restrict`, toks.admin, body({ adminId: "forged-admin", imposedBy: "forged-admin" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.restriction.imposedBy, adminId);
    assert.notEqual(r.body.restriction.imposedBy, "forged-admin");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PT_CONTRACT_RESTRICTED", entityId: c.binh.id } });
    assert.equal(audit.actorUserId, adminId);
  } finally {
    s.restore();
    await cleanup([pt, pt2], ids);
  }
});

test("restrict / lift: request, response, codes, idempotency and validation", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const other = await makeAn();
  const pending = await makeContract(pt, { status: "PENDING_PAYMENT", paymentTransactionId: null, startDate: null, endDate: null });
  const admin = tokenFor(randomUUID(), "ADMIN");
  const s = stubs();
  try {
    const url = (cid: string, action = "restrict", ptId = pt) => `/admin/pts/${ptId}/contracts/${cid}/${action}`;
    // validation: reason required, category known, contract must be this PT's and ACTIVE
    let r = await app.call("POST", url(c.binh.id), admin, { category: "COMPLAINT_REVIEW" });
    assert.deepEqual([r.status, r.body.code], [400, "REASON_REQUIRED"]);
    r = await app.call("POST", url(c.binh.id), admin, body({ category: "NOPE" }));
    assert.deepEqual([r.status, r.body.code], [400, "REASON_CATEGORY_INVALID"]);
    r = await app.call("POST", url(other.contracts.binh.id), admin, body());
    assert.deepEqual([r.status, r.body.code], [404, "CONTRACT_NOT_FOUND"], "another PT's contract under this PT's URL");
    r = await app.call("POST", url(randomUUID()), admin, body());
    assert.deepEqual([r.status, r.body.code], [404, "CONTRACT_NOT_FOUND"]);
    r = await app.call("POST", url(pending.id), admin, body());
    assert.deepEqual([r.status, r.body.code], [409, "CONTRACT_NOT_RESTRICTABLE"], "an unpaid contract has nothing to pause");
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt } }), 0);

    // the restriction
    r = await app.call("POST", url(c.binh.id), admin, body());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, true);
    assert.equal(r.body.restriction.scope, "CONTRACT");
    assert.equal(r.body.restriction.contractId, c.binh.id);
    assert.equal(r.body.restriction.type, "TEMPORARY_SUSPENSION");
    assert.deepEqual(r.body.notified, { client: true, pt: true });
    assert.equal(r.body.sessionsCancelled, 0);
    const again = await app.call("POST", url(c.binh.id), admin, body());
    assert.equal(again.status, 200);
    assert.equal(again.body.changed, false, "idempotent");
    assert.equal(again.body.restriction.id, r.body.restriction.id);
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt } }), 1);

    // history / list include it; the list can be filtered by scope
    r = await app.call("GET", `/admin/pts/${pt}/restrictions`, admin);
    assert.equal(r.body.restrictions.length, 1);
    assert.equal(r.body.restrictions[0].scope, "CONTRACT");
    assert.equal(r.body.restrictions[0].contract.id, c.binh.id);
    r = await app.call("GET", "/admin/pts/suspended?scope=CONTRACT", admin);
    assert.ok(r.body.items.some((i: any) => i.ptUserId === pt && i.contractId === c.binh.id && i.pausedContracts === 1));
    r = await app.call("GET", "/admin/pts/suspended?scope=ACCOUNT", admin);
    assert.ok(!r.body.items.some((i: any) => i.ptUserId === pt));
    // justify the continuation of the CONTRACT episode (not the account one)
    r = await app.call("POST", `/admin/pts/${pt}/restrictions/justify`, admin, { reason: "vẫn đang xem xét", contractId: c.binh.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.restriction.contractId, c.binh.id);
    r = await app.call("POST", `/admin/pts/${pt}/restrictions/justify`, admin, { reason: "vẫn đang xem xét" });
    assert.deepEqual([r.status, r.body.code], [409, "NO_ACTIVE_SUSPENSION"], "no ACCOUNT episode to justify");

    // the lift
    r = await app.call("POST", url(c.binh.id, "lift-restriction"), admin, {});
    assert.deepEqual([r.status, r.body.code], [400, "REASON_REQUIRED"]);
    r = await app.call("POST", url(c.binh.id, "lift-restriction"), admin, { reason: "xong" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, true);
    assert.equal(r.body.stillPausedByAccount, false);
    assert.equal(r.body.contractsExtended.length, 1);
    assert.equal(r.body.contractsExtended[0].contractId, c.binh.id);
    assert.equal(r.body.restriction.liftedBy, (await prisma.ptRestriction.findFirstOrThrow({ where: { contractId: c.binh.id } })).liftedBy);
    r = await app.call("POST", url(c.binh.id, "lift-restriction"), admin, { reason: "xong" });
    assert.deepEqual([r.status, r.body.changed], [200, false], "lifting twice is a no-op");
    r = await app.call("POST", url(other.contracts.binh.id, "lift-restriction"), admin, { reason: "xong" });
    assert.deepEqual([r.status, r.body.code], [404, "CONTRACT_NOT_FOUND"], "lifting another PT's contract under this PT's URL");

    // a banned PT cannot get a contract restriction
    await prisma.$transaction(async (tx) => {
      await openEpisode(tx, { ptUserId: other.pt, type: "PERMANENT_BAN", reasonCategory: "UNSPECIFIED", reasonText: "ban", imposedBy: "a", startedAt: new Date() });
      await syncPtSuspendedFlag(tx, other.pt);
    });
    r = await app.call("POST", url(other.contracts.chi.id, "restrict", other.pt), admin, body());
    assert.deepEqual([r.status, r.body.code], [409, "PT_ALREADY_BANNED"]);
    r = await app.call("POST", `/admin/pts/${other.pt}/restrictions/change-scope`, admin, { to: "CONTRACT", contractIds: [other.contracts.chi.id], reason: "x" });
    assert.deepEqual([r.status, r.body.code], [409, "PT_BAN_LIFTS_VIA_ACCOUNT_UNLOCK"], "a ban is not narrowed");
    r = await app.call("POST", `/admin/pts/${other.pt}/restrictions/change-scope`, admin, { to: "ACCOUNT", contractId: other.contracts.chi.id, reason: "x" });
    assert.deepEqual([r.status, r.body.code], [409, "PT_ALREADY_BANNED"]);
  } finally {
    s.restore();
    await cleanup([pt, other.pt], [...ids, ...other.ids, pending.id]);
  }
});

test("change-scope endpoint: raise and narrow over HTTP, validation and the codes of the impossible changes", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const admin = tokenFor(randomUUID(), "ADMIN");
  const s = stubs();
  try {
    const url = `/admin/pts/${pt}/restrictions/change-scope`;
    let r = await app.call("POST", url, admin, { to: "SIDEWAYS", reason: "x" });
    assert.deepEqual([r.status, r.body.code], [400, "SCOPE_CHANGE_INVALID"]);
    r = await app.call("POST", url, admin, { to: "ACCOUNT", contractId: c.binh.id });
    assert.deepEqual([r.status, r.body.code], [400, "REASON_REQUIRED"]);
    r = await app.call("POST", url, admin, { to: "ACCOUNT", reason: "x" });
    assert.deepEqual([r.status, r.body.code], [400, "CONTRACT_ID_REQUIRED"]);
    r = await app.call("POST", url, admin, { to: "ACCOUNT", contractId: c.binh.id, reason: "x" });
    assert.deepEqual([r.status, r.body.code], [409, "NO_ACTIVE_CONTRACT_RESTRICTION"], "nothing to raise");
    r = await app.call("POST", url, admin, { to: "CONTRACT", contractIds: [], reason: "x" });
    assert.deepEqual([r.status, r.body.code], [400, "CONTRACT_IDS_REQUIRED"]);
    r = await app.call("POST", url, admin, { to: "CONTRACT", contractIds: [c.binh.id], reason: "x" });
    assert.deepEqual([r.status, r.body.code], [409, "NO_ACTIVE_SUSPENSION"], "nothing to narrow");
    r = await app.call("POST", url, admin, { to: "CONTRACT", contractIds: [randomUUID()], reason: "x" });
    assert.deepEqual([r.status, r.body.code], [404, "CONTRACT_NOT_FOUND"]);
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt } }), 0, "nothing written by the refused calls");

    // raise
    await app.call("POST", `/admin/pts/${pt}/contracts/${c.binh.id}/restrict`, admin, body());
    r = await app.call("POST", url, admin, { to: "ACCOUNT", contractId: c.binh.id, reason: "rủi ro rộng hơn" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, true);
    assert.equal(r.body.closedRestriction.endKind, "SCOPE_RAISED");
    assert.equal(r.body.openedRestrictions[0].scope, "ACCOUNT");
    assert.equal(r.body.openedRestrictions[0].supersedesRestrictionId, r.body.closedRestriction.id);
    // narrow it back
    r = await app.call("POST", url, admin, { to: "CONTRACT", contractIds: [c.binh.id, c.chi.id], reason: "chỉ còn hai hợp đồng" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.closedRestriction.endKind, "SCOPE_NARROWED");
    assert.deepEqual(new Set(r.body.openedRestrictions.map((o: any) => o.contractId)), new Set([c.binh.id, c.chi.id]));
    for (const o of r.body.openedRestrictions) assert.equal(o.scope, "CONTRACT");
    // the full history shows every step with who/why
    r = await app.call("GET", `/admin/pts/${pt}/restrictions`, admin);
    assert.equal(r.body.restrictions.length, 4);
    for (const h of r.body.restrictions) assert.ok(h.reasonText && h.imposedBy, "reason and actor recorded on every row");
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

test("reads: the PT sees only the public reason, another PT sees none of it, a client sees no reason; the internal answer is per contract", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const pt2 = await makePt();
  const ptTok = tokenFor(pt, "PT");
  const pt2Tok = tokenFor(pt2, "PT");
  const binhTok = tokenFor(c.binh.clientUserId, "CUSTOMER");
  const chiTok = tokenFor(c.chi.clientUserId, "CUSTOMER");
  const s = stubs();
  try {
    const q = (ptId: string, contractId?: string) => `/internal/pt/${ptId}/restriction${contractId ? `?contractId=${contractId}` : ""}`;
    // nothing yet
    let r = await app.call("GET", q(pt, c.binh.id), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.body.mayCoach, r.body.contractRestricted, r.body.scope], [true, false, null]);

    await ptRestrictionService.restrictContract({ ptUserId: pt, contractId: c.binh.id, adminId: ADMIN, reasonCategory: "COMPLAINT_REVIEW", reasonText: "nội bộ bí mật", publicReason: "Đang xem xét một phản ánh" });

    // the internal answer (what the future gym check-in must call): per contract
    assert.equal((await app.call("GET", q(pt), null)).status, 401, "service secret required");
    r = await app.call("GET", q(pt), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.status, r.body.restricted, r.body.mayCoach, r.body.mayTakeNewBusiness], [200, false, true, true], "without a contract: An may coach (the account is not restricted)");
    assert.deepEqual(r.body.restrictedContractIds, [c.binh.id]);
    r = await app.call("GET", q(pt, c.binh.id), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.body.mayCoach, r.body.contractRestricted, r.body.scope, r.body.restricted], [false, true, "CONTRACT", false], "Bình's session: not allowed to coach");
    r = await app.call("GET", q(pt, c.chi.id), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.body.mayCoach, r.body.contractRestricted, r.body.scope], [true, false, null], "Chi's session: An may check in and teach");
    r = await app.call("GET", q(pt, randomUUID()), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.status, r.body.code], [404, "CONTRACT_NOT_FOUND"]);
    r = await app.call("GET", q(pt2, c.binh.id), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.status, r.body.code], [404, "CONTRACT_NOT_FOUND"], "a contract that is not this PT's");

    // an ACCOUNT restriction stops coaching on every contract, and without a contract too
    await ptRestrictionService.suspend({ ptUserId: pt, adminId: ADMIN, reasonCategory: "OTHER", reasonText: "t" });
    r = await app.call("GET", q(pt), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.body.restricted, r.body.mayCoach, r.body.mayTakeNewBusiness], [true, false, false]);
    r = await app.call("GET", q(pt, c.chi.id), null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.body.mayCoach, r.body.scope], [false, "ACCOUNT"]);
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "xong" });

    // other internal reads: still offered for new business, but the fitness-service relationship check refuses Bình
    r = await app.call("GET", `/internal/pt-marketplace-eligibility/${pt}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.ptRestricted, false, "An is still offered for new business");
    r = await app.call("GET", `/internal/contracts/active-relationship?ptUserId=${pt}&clientUserId=${c.binh.clientUserId}`, null, undefined, SERVICE_SECRET);
    assert.deepEqual([r.body.active, r.body.reason], [false, "PT_RESTRICTED"], "no coaching-data access for the paused contract");
    r = await app.call("GET", `/internal/contracts/active-relationship?ptUserId=${pt}&clientUserId=${c.chi.clientUserId}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.active, true);

    // the PT's own read: public reason only; another PT reads only their own (nothing)
    r = await app.call("GET", "/profile/me/restriction", ptTok);
    assert.equal(r.body.contractRestrictions.length, 1);
    assert.ok(!JSON.stringify(r.body).includes("bí mật"));
    r = await app.call("GET", "/profile/me/restriction", pt2Tok);
    assert.deepEqual([r.body.restricted, r.body.contractRestrictions.length], [false, 0], "one PT cannot read another's restriction");
    // clients: effective status only
    r = await app.call("GET", `/contracts/${c.binh.id}`, binhTok);
    assert.equal(r.body.effectiveStatus, "PAUSED_BY_ADMIN");
    assert.ok(!JSON.stringify(r.body).includes("bí mật") && !JSON.stringify(r.body).includes("COMPLAINT_REVIEW"));
    r = await app.call("GET", `/contracts/${c.binh.id}`, chiTok);
    assert.equal(r.status === 403 || r.status === 404, true, "Chi cannot read Bình's contract");
  } finally {
    s.restore();
    await cleanup([pt, pt2], ids);
  }
});

test("a permanent ban closes the PT's contract-scope episodes (the unwind then ends the contracts); nothing stays restricted on a contract that no longer exists as ACTIVE", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const s = stubs();
  try {
    await ptRestrictionService.restrictContract({ ptUserId: pt, contractId: c.binh.id, adminId: ADMIN, reasonCategory: "OTHER", reasonText: "t" });
    const res = await ptDeactivationService.deactivatePT({ ptUserId: pt, adminId: "admin-9", reason: "vi phạm", seq: 77n } as any);
    assert.equal(res.complete, true, JSON.stringify(res));
    const rows = await prisma.ptRestriction.findMany({ where: { ptUserId: pt } });
    const contractRow = rows.find((r) => r.scope === "CONTRACT")!;
    assert.equal(contractRow.endKind, "CONVERTED_TO_PERMANENT");
    assert.ok(rows.some((r) => r.scope === "ACCOUNT" && r.type === "PERMANENT_BAN" && r.endedAt === null));
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true);
    for (const n of ["binh", "chi", "dung", "em"] as const) {
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c[n].id } })).status, "CANCELLED", `${n} unwound by the ban`);
    }
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

// ── database rules added by the migration ───────────────────────────────────────────────────────

test("database: one ACTIVE account episode per PT and one ACTIVE contract episode per contract, they coexist; CONTRACT scope needs a contract and is never a ban; rows without a scope are ACCOUNT", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const base = { ptUserId: pt, reasonCategory: "OTHER" as const, imposedBy: "a" };
  const ghostPt = randomUUID(); // pt_user_id has no foreign key; used only to probe the CHECK
  try {
    // a row written the way every pre-scope caller wrote it is an ACCOUNT row
    const legacyShaped = await prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION" } });
    assert.equal(legacyShaped.scope, "ACCOUNT");
    assert.equal(legacyShaped.contractId, null);
    // a second ACCOUNT episode is refused ...
    await assert.rejects(prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION" } }), /Unique constraint|unique/i);
    // ... but contract episodes coexist with it, one per contract
    await prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION", scope: "CONTRACT", contractId: c.binh.id } });
    await prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION", scope: "CONTRACT", contractId: c.chi.id } });
    await assert.rejects(prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION", scope: "CONTRACT", contractId: c.binh.id } }), /Unique constraint|unique/i);
    // a closed episode frees the slot
    await prisma.ptRestriction.updateMany({ where: { contractId: c.binh.id }, data: { endedAt: new Date() } });
    await prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION", scope: "CONTRACT", contractId: c.binh.id } });
    // CHECKs
    await assert.rejects(prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION", scope: "CONTRACT" } }), /check|constraint/i);
    await assert.rejects(prisma.ptRestriction.create({ data: { ...base, ptUserId: ghostPt, type: "TEMPORARY_SUSPENSION", scope: "ACCOUNT", contractId: c.dung.id } }), /check|constraint/i);
    await assert.rejects(prisma.ptRestriction.create({ data: { ...base, type: "PERMANENT_BAN", scope: "CONTRACT", contractId: c.em.id } }), /check|constraint/i);
    // the mirror ignores contract episodes: only the ACCOUNT row counts
    await prisma.$transaction((tx) => syncPtSuspendedFlag(tx, pt));
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true);
    await prisma.ptRestriction.updateMany({ where: { ptUserId: pt, scope: "ACCOUNT" }, data: { endedAt: new Date() } });
    await prisma.$transaction((tx) => syncPtSuspendedFlag(tx, pt));
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false, "two active contract episodes do not make the PT suspended");
    // D58 item 7: restriction history is audit data - deleting a contract that still has episodes is REFUSED (ON DELETE RESTRICT, P2003)
    await prisma.ptRestriction.create({ data: { ...base, type: "TEMPORARY_SUSPENSION", scope: "CONTRACT", contractId: c.em.id } });
    await assert.rejects(() => prisma.contract.delete({ where: { id: c.em.id } }), (e: any) => e?.code === "P2003");
    assert.ok((await prisma.ptRestriction.count({ where: { contractId: c.em.id } })) >= 1, "the history survived the refused delete");
    // removing it on purpose = history first (this is what cleanup() in pt-restriction.test-helpers.ts already does)
    await prisma.ptRestriction.deleteMany({ where: { contractId: c.em.id } });
    await prisma.contract.delete({ where: { id: c.em.id } });
  } finally {
    await cleanup([pt, ghostPt], ids);
  }
});

test("(2-3 evidence) a PT with only a contract restriction stays discoverable; an account suspension hides them (control)", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const marker = `ScopeAn${randomUUID().slice(0, 8)}`;
  await prisma.userProfile.update({ where: { userId: pt }, data: { firstName: marker, firstNameNormalized: marker.toLowerCase() } });
  const viewer = tokenFor(randomUUID(), "CUSTOMER");
  const s = stubs();
  try {
    const found = async () => {
      const r = await app.call("GET", `/profile/pts?q=${marker}`, viewer);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const list = r.body.data ?? r.body.pts ?? r.body.items ?? r.body;
      return Array.isArray(list) && list.some((p: any) => p.userId === pt);
    };
    assert.equal(await found(), true, "control: discoverable before any restriction");
    await ptRestrictionService.restrictContract({ ptUserId: pt, contractId: c.binh.id, adminId: ADMIN, reasonCategory: "OTHER", reasonText: "t" });
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false);
    assert.equal(await found(), true, "contract restriction: still discoverable");
    await ptRestrictionService.suspend({ ptUserId: pt, adminId: ADMIN, reasonCategory: "OTHER", reasonText: "t" });
    assert.equal(await found(), false, "control: an account suspension hides the PT");
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});
