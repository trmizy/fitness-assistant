/**
 * D25 - PT terms re-acceptance.
 *
 * Evidence label: BACKEND INTEGRATION. The real user-service Express app is started on a random port and called over HTTP
 * against an isolated `*_test` database (the guard in test-db-guard.ts refuses anything else); auth-service is NOT running
 * (token -> identity table, payment-service and the notification push are stubbed at the client boundary) - TEST FIXTURE for
 * those halves. Contract / application rows are inserted directly (TEST FIXTURE); the HTTP calls and the gate under test are real.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_d25_test?schema=public" \
 *     FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --test src/__tests__/pt-terms-acceptance.integration.test.ts
 *
 * Covers: a new applicant, an existing PT who has not confirmed, a PT who confirmed, a stale/old version, idempotency,
 * contracts that were already accepted (unchanged), and "nothing writes money".
 */
process.env.REQUIRE_CONTRACT_ESIGN = "false"; // module-level constant in contract.service: must be set BEFORE the app is imported
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import fs from "node:fs";
import path from "node:path";
import { PT_TERMS_VERSION, PT_TERMS_SECTIONS } from "../services/pt-terms";
import { cleanup, makeContract, makePt, patch, skip, stubs, type Stubs } from "./pt-restriction.test-helpers";

const identities = new Map<string, { id: string; email: string; role: string }>();
function tokenFor(id: string, role: string): string {
  const token = `tok-${id}`;
  identities.set(token, { id, email: `${id}@test.local`, role });
  return token;
}

let server: http.Server;
let base = "";
const restores: Array<() => void> = [];
let st: Stubs;

test.before(async () => {
  if (skip) return;
  restores.push(
    patch(authServiceClient, "verifyToken", async (header: string) => {
      const user = identities.get(String(header).replace(/^Bearer /, ""));
      if (!user) throw Object.assign(new Error("bad token"), { response: { status: 401, data: { error: "Invalid or expired token" } } });
      return { status: 200, data: { user } };
    }),
    // acceptContract looks both parties up for the e-sign emails and the PDF (the PDF itself is real; the files are removed in afterEach).
    patch(authServiceClient, "internalGet", async (path: string) => ({
      data: { user: { email: `${path.split("/").pop()}@test.local`, firstName: "T", lastName: "User" } },
    })),
  );
  st = stubs();
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

test.after(async () => {
  if (skip) return;
  st?.restore?.();
  restores.reverse().forEach((r) => r());
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const reviewContract = (pt: string) =>
  makeContract(pt, { status: "PENDING_REVIEW", paymentTransactionId: null, startDate: null, endDate: null, clientUserId: randomUUID(), gymId: null });

async function contractsOf(pt: string) {
  return JSON.stringify(await prisma.contract.findMany({ where: { ptUserId: pt }, orderBy: { id: "asc" } }));
}
const termsRows = (userId: string) => prisma.ptTermsAcceptance.findMany({ where: { userId } });
const termsAudits = (userId: string) => prisma.auditLog.count({ where: { entityId: userId, action: "PT_TERMS_ACCEPTED" } });

const created: string[] = [];
test.afterEach(async () => {
  if (skip) return;
  for (const c of await prisma.contract.findMany({ where: { ptUserId: { in: created } }, select: { id: true } })) {
    fs.rmSync(path.join(process.cwd(), "uploads", "contracts", `${c.id}.pdf`), { force: true });
  }
  await cleanup(created, []);
  await prisma.contract.deleteMany({ where: { ptUserId: { in: created } } }).catch(() => {});
  await prisma.ptTermsAcceptance.deleteMany({ where: { userId: { in: created } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: created } }, { actorUserId: { in: created } }] } }).catch(() => {});
  created.length = 0;
  st.payments.length = 0;
  st.notified.length = 0;
});

test("the served text: one versioned source, every clause has a body, internal source notes are not served, needs a signed-in user", { skip }, async () => {
  const u = randomUUID();
  created.push(u);
  const r = await call("GET", "/pt-applications/terms", tokenFor(u, "CUSTOMER"));
  assert.equal(r.status, 200);
  assert.equal(r.body.version, PT_TERMS_VERSION);
  assert.equal(r.body.isDraft, true, "the wording is a DRAFT until the owner approves it");
  assert.equal(r.body.sections.length, PT_TERMS_SECTIONS.length);
  for (const s of r.body.sections) {
    assert.ok(s.title && s.body.length > 0, `section ${s.id} has text`);
    assert.equal(s.source, undefined, "code/decision references are server-side notes, never served");
  }
  const everything = JSON.stringify(r.body);
  assert.doesNotMatch(everything, /holdback/i, "no internal term is served");
  assert.match(everything, /chỉ áp dụng cho hợp đồng được tạo sau khi quy định này có hiệu lực/, "the holdback is described as non-retroactive: it never applies to a contract that already exists");
  assert.equal((await call("GET", "/pt-applications/terms", null)).status, 401);
  assert.equal((await call("POST", "/pt-applications/terms/accept", null, { version: PT_TERMS_VERSION })).status, 401);
});

test("NEW APPLICANT: submitting needs the ticked terms; the tick (version) records the acceptance; nothing is recorded by a refused submit", { skip }, async () => {
  const u = randomUUID();
  created.push(u);
  const tok = tokenFor(u, "CUSTOMER");
  const profile = await prisma.userProfile.create({ data: { userId: u } }); // an applicant: not a PT yet (isPT false)
  await prisma.pTApplication.create({
    data: {
      userProfileId: profile.id,
      status: "DRAFT",
      phoneNumber: "0900000000",
      nationalIdNumber: "012345678901",
      currentAddress: "1 Test St",
      idCardFrontUrl: "/uploads/pt-applications/a.jpg",
      idCardBackUrl: "/uploads/pt-applications/b.jpg",
      portraitPhotoUrl: "/uploads/pt-applications/c.jpg",
      yearsOfExperience: "3",
      serviceMode: "ONLINE",
      onlinePricePerSession: 200000,
      mainSpecialties: ["Strength"],
    },
  });
  const status = async () => (await prisma.pTApplication.findUniqueOrThrow({ where: { userProfileId: profile.id } })).status;

  let r = await call("GET", "/pt-applications/terms", tok);
  assert.deepEqual([r.body.accepted, r.body.mustReconfirm], [false, false], "an applicant is not 're-confirming' - just has not accepted yet");

  r = await call("POST", "/pt-applications/me/submit", tok); // box not ticked / old client: no version
  assert.deepEqual([r.status, r.body.code, r.body.termsVersion], [409, "PT_TERMS_NOT_ACCEPTED", PT_TERMS_VERSION]);
  assert.equal(await status(), "DRAFT");
  r = await call("POST", "/pt-applications/me/submit", tok, { termsVersion: "2020-01-old" }); // a stale text was ticked
  assert.deepEqual([r.status, r.body.code], [409, "PT_TERMS_VERSION_MISMATCH"]);
  assert.equal(await status(), "DRAFT");
  assert.equal((await termsRows(u)).length, 0, "a refused submit records no acceptance");

  r = await call("POST", "/pt-applications/me/submit", tok, { termsVersion: PT_TERMS_VERSION });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await status(), "SUBMITTED");
  const rows = await termsRows(u);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].version, rows[0].source], [PT_TERMS_VERSION, "APPLICATION"]);
  assert.equal(await termsAudits(u), 1, "the acceptance is audited");

  // After approval the new PT is already confirmed: no banner, no 409 on their first accept.
  await prisma.userProfile.update({ where: { userId: u }, data: { isPT: true } }); // TEST FIXTURE for the admin approval
  r = await call("GET", "/pt-applications/terms", tok);
  assert.deepEqual([r.body.accepted, r.body.mustReconfirm], [true, false]);
  const c = await reviewContract(u);
  assert.equal((await call("PATCH", `/contracts/${c.id}/accept`, tokenFor(u, "PT"))).status, 200);

  // Re-submitting after "needs more info" works without sending the version again (it is on file).
  await prisma.pTApplication.update({ where: { userProfileId: profile.id }, data: { status: "NEEDS_MORE_INFO" } });
  r = await call("POST", "/pt-applications/me/submit", tok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await termsRows(u)).length, 1, "still one acceptance row");
});

test("EXISTING PT who has NOT re-confirmed: banner state, acceptContract is refused 409 PT_TERMS_NOT_ACCEPTED and NOTHING is written", { skip }, async () => {
  const pt = await makePt();
  created.push(pt);
  const tok = tokenFor(pt, "PT");
  const c = await reviewContract(pt);
  const other = await makeContract(pt, { clientUserId: randomUUID() }); // an ACTIVE contract of the same PT
  const before = await contractsOf(pt);
  const auditBefore = await prisma.auditLog.count({ where: { entityId: c.id } });
  const settlementsBefore = await prisma.sessionSettlement.count({ where: { contractId: { in: [c.id, other.id] } } });

  let r = await call("GET", "/pt-applications/terms", tok);
  assert.deepEqual([r.body.accepted, r.body.mustReconfirm, r.body.previouslyAcceptedVersion], [false, true, null]);

  r = await call("PATCH", `/contracts/${c.id}/accept`, tok);
  assert.deepEqual([r.status, r.body.code, r.body.termsVersion], [409, "PT_TERMS_NOT_ACCEPTED", PT_TERMS_VERSION]);
  assert.match(r.body.error, /Điều khoản/);
  assert.equal(await contractsOf(pt), before, "no contract row changed (status, dates, pdf path, e-sign fields, due date)");
  assert.equal(await prisma.auditLog.count({ where: { entityId: c.id } }), auditBefore, "no audit row");
  assert.equal(st.notified.length, 0, "the client was not told the PT accepted");
  assert.equal(st.payments.length, 0, "no money call");
  assert.equal(await prisma.sessionSettlement.count({ where: { contractId: { in: [c.id, other.id] } } }), settlementsBefore, "no settlement row");
  assert.equal((await termsRows(pt)).length, 0);
  // the PT can still say no (reject is not "taking a new contract") - and read
  assert.equal((await call("GET", "/contracts/pt", tok)).status, 200);
});

test("PT who CONFIRMED: stale version -> 409 and nothing stored; current version -> recorded + audited; idempotent; then acceptContract goes through", { skip }, async () => {
  const pt = await makePt();
  created.push(pt);
  const tok = tokenFor(pt, "PT");
  const c = await reviewContract(pt);

  let r = await call("POST", "/pt-applications/terms/accept", tok, { version: "2020-01-old" });
  assert.deepEqual([r.status, r.body.code, r.body.termsVersion], [409, "PT_TERMS_VERSION_MISMATCH", PT_TERMS_VERSION]);
  r = await call("POST", "/pt-applications/terms/accept", tok, {});
  assert.equal(r.status, 409, "no version at all is not an acceptance either");
  assert.equal((await termsRows(pt)).length, 0, "a refused confirmation stores nothing");

  r = await call("POST", "/pt-applications/terms/accept", tok, { version: PT_TERMS_VERSION, userId: randomUUID() });
  assert.deepEqual([r.status, r.body.accepted, r.body.version], [200, true, PT_TERMS_VERSION]);
  const first = (await termsRows(pt))[0];
  assert.deepEqual([first.userId, first.source], [pt, "RECONFIRM"], "the AUTHENTICATED user is confirmed - a userId in the body is ignored; an approved PT is RECONFIRM");
  assert.equal(await termsAudits(pt), 1);

  r = await call("POST", "/pt-applications/terms/accept", tok, { version: PT_TERMS_VERSION });
  assert.equal(r.status, 200, "idempotent re-accept");
  const rows = await termsRows(pt);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].acceptedAt.getTime(), first.acceptedAt.getTime(), "the first confirmation time is kept");
  assert.equal(await termsAudits(pt), 1, "a repeat is not audited twice");

  r = await call("GET", "/pt-applications/terms", tok);
  assert.deepEqual([r.body.accepted, r.body.mustReconfirm], [true, false]);

  r = await call("PATCH", `/contracts/${c.id}/accept`, tok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(after.status, "PENDING_PAYMENT");
  assert.ok(after.paymentDueAt, "the 12-hour payment deadline starts as before");
  const audit = await prisma.auditLog.findFirst({ where: { entityId: c.id, action: "CONTRACT_PENDING_PAYMENT" } });
  assert.equal((audit?.metadata as any)?.ptTermsVersion, PT_TERMS_VERSION, "which terms the PT accepted this contract under is on the audit trail");
  assert.equal(st.payments.length, 0, "accepting touches no money");
});

test("VERSION BUMP / OLD VERSION: a confirmation of an older version does not open the gate; the banner says the terms were updated", { skip }, async () => {
  const pt = await makePt();
  created.push(pt);
  const tok = tokenFor(pt, "PT");
  await prisma.ptTermsAcceptance.create({ data: { userId: pt, version: "2026-01-pt-v0", source: "APPLICATION" } }); // confirmed an earlier text
  const c = await reviewContract(pt);

  let r = await call("GET", "/pt-applications/terms", tok);
  assert.deepEqual([r.body.accepted, r.body.mustReconfirm, r.body.previouslyAcceptedVersion], [false, true, "2026-01-pt-v0"]);
  r = await call("PATCH", `/contracts/${c.id}/accept`, tok);
  assert.deepEqual([r.status, r.body.code], [409, "PT_TERMS_NOT_ACCEPTED"]);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "PENDING_REVIEW");

  assert.equal((await call("POST", "/pt-applications/terms/accept", tok, { version: PT_TERMS_VERSION })).status, 200);
  assert.equal((await termsRows(pt)).length, 2, "history is kept: the old confirmation stays, the new one is added");
  assert.equal((await call("PATCH", `/contracts/${c.id}/accept`, tok)).status, 200);
});

test("ALREADY-ACCEPTED contracts are untouched: confirming the terms (or not) never rewrites a contract, and a non-confirmed PT keeps working on an ACTIVE one", { skip }, async () => {
  const pt = await makePt();
  created.push(pt);
  const tok = tokenFor(pt, "PT");
  const active = await makeContract(pt, { clientUserId: randomUUID() });
  const pendingPay = await makeContract(pt, { status: "PENDING_PAYMENT", paymentTransactionId: null, paymentDueAt: new Date(Date.now() + 3600_000), startDate: null, endDate: null });
  const before = await contractsOf(pt);

  // never confirmed: the PT's running contract is still readable and nothing about it changed by the gate or by the terms endpoints
  assert.equal((await call("GET", `/contracts/${active.id}`, tok)).status, 200);
  assert.equal((await call("GET", "/pt-applications/terms", tok)).status, 200);
  assert.equal(await contractsOf(pt), before);

  // confirm now: still byte-identical (the acceptance is its own table; it is not stamped on contracts)
  assert.equal((await call("POST", "/pt-applications/terms/accept", tok, { version: PT_TERMS_VERSION })).status, 200);
  assert.equal(await contractsOf(pt), before, "ACTIVE / PENDING_PAYMENT contracts are identical before and after");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: pendingPay.id } })).status, "PENDING_PAYMENT");
  assert.equal(st.payments.length, 0, "no money call at any point");
});

// ── D74: the admin "skip e-sign" path must not bypass the terms gate ─────────────────────────────────────────────
test("ADMIN skip-e-sign path: PT not confirmed -> refused 409 PT_TERMS_NOT_ACCEPTED, status/rows/money unchanged, and an admin cannot confirm for the PT; PT confirmed -> proceeds as before; an already-accepted contract (PENDING_SIGNATURE) is not re-gated", { skip }, async () => {
  const { contractService } = await import("../services/contract.service");
  const pt = await makePt();
  created.push(pt);
  const admin = randomUUID();
  created.push(admin);
  const c = await reviewContract(pt);
  const signing = await makeContract(pt, { status: "PENDING_SIGNATURE", paymentTransactionId: null, startDate: null, endDate: null, clientUserId: randomUUID() });
  const before = await contractsOf(pt);

  // an admin cannot accept the terms on the PT's behalf: the endpoint records the CALLER only
  const adminTok = tokenFor(admin, "ADMIN");
  assert.equal((await call("POST", "/pt-applications/terms/accept", adminTok, { version: PT_TERMS_VERSION, userId: pt, ptUserId: pt })).status, 200);
  assert.equal((await termsRows(pt)).length, 0, "nothing was recorded for the PT");
  await prisma.ptTermsAcceptance.deleteMany({ where: { userId: admin } });

  await assert.rejects(
    () => contractService.updateStatus(c.id, admin, "ACTIVE", "ADMIN"),
    (e: any) => e.status === 409 && e.code === "PT_TERMS_NOT_ACCEPTED" && e.termsVersion === PT_TERMS_VERSION,
  );
  assert.equal(await contractsOf(pt), before, "no contract row changed (status, due date, e-sign fields)");
  assert.equal(st.payments.length, 0, "no money call");
  assert.equal(await prisma.sessionSettlement.count({ where: { contractId: { in: [c.id, signing.id] } } }), 0);

  // a contract the PT already accepted earlier (e-sign step) is not asked again - the admin override works as today
  const forced = await contractService.updateStatus(signing.id, admin, "ACTIVE", "ADMIN");
  assert.equal((forced as any).status, "PENDING_PAYMENT");

  // PT confirmed the current terms -> the admin path proceeds as today (PENDING_PAYMENT with a fresh deadline; still needs payment)
  await call("POST", "/pt-applications/terms/accept", tokenFor(pt, "PT"), { version: PT_TERMS_VERSION });
  const ok = await contractService.updateStatus(c.id, admin, "ACTIVE", "ADMIN");
  assert.equal((ok as any).status, "PENDING_PAYMENT");
  assert.ok((ok as any).paymentDueAt);
  assert.equal(st.payments.length, 0);
});
