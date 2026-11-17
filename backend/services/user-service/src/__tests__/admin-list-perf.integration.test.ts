/**
 * FIX5-ADMIN-PERF (user-service half) — the admin PT-application list searched by applicant name/email in the
 * database (`q`), and the contract-count summary restricted to the ids of one page (`userIds`).
 *
 * Before: the web page downloaded every application (53 MB, ~16 s on 10k PTs) and searched in the browser; the
 * contract summary scanned every contract. The paging itself (C1-10) already existed server-side.
 *
 * Evidence label: BACKEND INTEGRATION against an isolated *_test database, e.g.
 *   DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test ./node_modules/.bin/tsx --test src/__tests__/admin-list-perf.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { ptApplicationRepository } from "../repositories/pt_application.repository";
import { ptApplicationController } from "../controllers/pt_application.controller";
import { profileController } from "../controllers/profile.controller";
import { skip } from "./test-db-guard";

const tag = `qperf${randomUUID().slice(0, 8)}`;
const created: { profileIds: string[] } = { profileIds: [] };

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      JSON.stringify(body);
      return this;
    },
  };
  return res;
}

async function makeApp(first: string, last: string, status: "SUBMITTED" | "APPROVED") {
  const userId = randomUUID();
  const profile = await prisma.userProfile.create({
    data: { userId, isPT: status === "APPROVED", firstName: first, lastName: last, email: `${first}.${tag}@seed.test`.toLowerCase() },
  });
  created.profileIds.push(profile.id);
  const app = await prisma.pTApplication.create({ data: { userProfileId: profile.id, status, submittedAt: new Date() } });
  return { userId, app };
}

test.after(async () => {
  if (skip) return;
  await prisma.pTApplication.deleteMany({ where: { userProfileId: { in: created.profileIds } } });
  await prisma.userProfile.deleteMany({ where: { id: { in: created.profileIds } } });
  await prisma.$disconnect();
});

test("repository: q matches first name, last name and email, case-insensitively, and combines with status", { skip }, async () => {
  const a = await makeApp(`Alpha${tag}`, "Nguyen", "SUBMITTED");
  const b = await makeApp("Beta", `Zeta${tag}`, "APPROVED");
  const c = await makeApp("Gamma", "Other", "SUBMITTED");

  const byFirst = await ptApplicationRepository.findAll({ q: `ALPHA${tag}` });
  assert.deepEqual(byFirst.map((r) => r.id), [a.app.id]);
  const byLast = await ptApplicationRepository.findAll({ q: `zeta${tag}` });
  assert.deepEqual(byLast.map((r) => r.id), [b.app.id]);
  const byEmail = await ptApplicationRepository.findAll({ q: `gamma.${tag}` });
  assert.deepEqual(byEmail.map((r) => r.id), [c.app.id]);

  // q + status: the SUBMITTED filter drops the APPROVED match.
  assert.equal((await ptApplicationRepository.findAll({ q: tag, status: "SUBMITTED" as any })).length, 2);
  assert.equal((await ptApplicationRepository.findAll({ q: tag, status: "APPROVED" as any })).length, 1);
  assert.equal(await ptApplicationRepository.countAll({ q: tag }), 3);
  assert.equal(await ptApplicationRepository.countAll({ q: `nomatch${tag}` }), 0);

  // The count is the total over ALL pages, the rows are one page.
  const page1 = await ptApplicationRepository.findAll({ q: tag }, { page: 1, limit: 2 });
  const page2 = await ptApplicationRepository.findAll({ q: tag }, { page: 2, limit: 2 });
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 1);
  assert.equal(new Set([...page1, ...page2].map((r) => r.id)).size, 3, "no row repeated or lost across pages");
});

test("controller: q + page + limit answers one page with X-Total-Count; a bad q is a 400", { skip }, async () => {
  await makeApp(`Delta${tag}`, "One", "SUBMITTED");
  await makeApp(`Delta${tag}`, "Two", "SUBMITTED");
  await makeApp(`Delta${tag}`, "Three", "SUBMITTED");

  const res = fakeRes();
  await ptApplicationController.listApplications({ query: { q: `delta${tag}`, page: "1", limit: "2" }, user: { id: "admin", role: "ADMIN" } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.headers["x-total-count"], "3");
  assert.equal(res.headers["x-page"], "1");
  assert.equal(res.headers["x-limit"], "2");

  const bad = fakeRes();
  await ptApplicationController.listApplications({ query: { q: ["a", "b"] }, user: { id: "admin", role: "ADMIN" } } as any, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.code, "INVALID_SEARCH");
  const tooLong = fakeRes();
  await ptApplicationController.listApplications({ query: { q: "x".repeat(101) }, user: { id: "admin", role: "ADMIN" } } as any, tooLong);
  assert.equal(tooLong.statusCode, 400);
});

test("contracts summary: userIds counts exactly those ids; bad lists are 400; no list keeps the old behaviour", { skip }, async () => {
  const pt = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const clientC = randomUUID();
  const contractIds: string[] = [];
  try {
    for (const clientUserId of [clientA, clientB, clientC]) {
      const row = await prisma.contract.create({
        data: { ptUserId: pt, clientUserId, status: "ACTIVE", dataOrigin: "REAL", packageName: "perf", totalSessions: 1 } as any,
      });
      contractIds.push(row.id);
    }
    const ok = fakeRes();
    await profileController.adminContractsSummary({ user: { id: "admin", role: "ADMIN" }, query: { userIds: `${pt},${clientA},${clientB}` } } as any, ok);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.body.summary, { [pt]: 3, [clientA]: 1, [clientB]: 1 });

    const only = fakeRes();
    await profileController.adminContractsSummary({ user: { id: "admin", role: "ADMIN" }, query: { userIds: clientB } } as any, only);
    assert.deepEqual(only.body.summary, { [clientB]: 1 });

    for (const userIds of ["", " , ", Array.from({ length: 201 }, (_, i) => `id${i}`).join(",")]) {
      const bad = fakeRes();
      await profileController.adminContractsSummary({ user: { id: "admin", role: "ADMIN" }, query: { userIds } } as any, bad);
      assert.equal(bad.statusCode, 400, `userIds=${userIds.slice(0, 12)}`);
      assert.equal(bad.body.code, "INVALID_USER_IDS");
    }

    const legacy = fakeRes();
    await profileController.adminContractsSummary({ user: { id: "admin", role: "ADMIN" }, query: {} } as any, legacy);
    assert.equal(legacy.statusCode, 200);
    assert.equal(legacy.body.summary[pt], 3, "no userIds = the unfiltered summary, as before");

    const notAdmin = fakeRes();
    await profileController.adminContractsSummary({ user: { id: "u", role: "CUSTOMER" }, query: { userIds: pt } } as any, notAdmin);
    assert.equal(notAdmin.statusCode, 403);
  } finally {
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  }
});

test("bare list (no page / limit) is capped at 50 with X-Total-Count; order=oldest and q words/accents", { skip }, async () => {
  const t = `cap${randomUUID().slice(0, 6)}`;
  const first = await makeApp(`Nguyễn${t}`, "Minh Khoa", "SUBMITTED");
  const second = await makeApp(`Nguyễn${t}`, "Hoàng An", "SUBMITTED");
  await prisma.pTApplication.update({ where: { id: first.app.id }, data: { submittedAt: new Date("2026-01-01T00:00:00Z") } });
  await prisma.pTApplication.update({ where: { id: second.app.id }, data: { submittedAt: new Date("2026-02-01T00:00:00Z") } });
  // profiles made here have no *_normalized columns: the accent-insensitive match must still find them through the raw columns
  const bare = fakeRes();
  await ptApplicationController.listApplications({ query: { q: `nguyen${t}`.replace("nguyen", "Nguyễn") } } as any, bare);
  assert.equal(bare.statusCode, 200);
  assert.equal(bare.headers["x-limit"], "50");
  assert.equal(bare.headers["x-page"], "1");
  assert.equal(bare.headers["x-total-count"], "2");

  // newest first by default, earliest first with order=oldest
  const newest = fakeRes();
  await ptApplicationController.listApplications({ query: { q: t, status: "SUBMITTED" } } as any, newest);
  assert.deepEqual(newest.body.map((r: any) => r.id), [second.app.id, first.app.id]);
  const oldest = fakeRes();
  await ptApplicationController.listApplications({ query: { q: t, status: "SUBMITTED", order: "oldest" } } as any, oldest);
  assert.deepEqual(oldest.body.map((r: any) => r.id), [first.app.id, second.app.id]);
  const badOrder = fakeRes();
  await ptApplicationController.listApplications({ query: { order: "random" } } as any, badOrder);
  assert.equal(badOrder.statusCode, 400);
  assert.equal(badOrder.body.code, "INVALID_ORDER");

  // every word must match, in any of first name / last name / email
  const both = await ptApplicationRepository.findAll({ q: `${t} khoa` });
  assert.deepEqual(both.map((r) => r.id), [first.app.id]);
  assert.equal((await ptApplicationRepository.findAll({ q: `${t} khoa an` })).length, 0, "one word matches nobody -> no row");
});
