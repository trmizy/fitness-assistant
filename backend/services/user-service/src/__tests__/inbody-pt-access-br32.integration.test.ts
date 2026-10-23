import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { ContractStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { inbodyService } from "../services/inbody.service";

/**
 * Audit finding #9 (owner decision APPROVED, final) - a PT reads a client's InBody history through user-service
 * (GET /inbody/client/:clientUserId -> inbodyService.getClientHistory) ONLY while a contract between them is ACTIVE.
 * COMPLETED / CANCELLED / EXPIRED / REJECTED / never-paid contracts, another PT and "no relationship" are all 403.
 * This is UNCONDITIONAL: the BR-32 fallback (ACTIVE or COMPLETED) and its INBODY_PT_ACCESS_ACTIVE_ONLY switch are gone, so the old
 * variable is inert (asserted below). The client always reads their own history. No InBody data is ever deleted or changed by any of
 * this (asserted below). There is no client-granted-access / consent model in user-service: none is built here.
 *
 * Evidence: BACKEND INTEGRATION on an isolated `*_test` database (service function and the REAL Express app over HTTP;
 * auth-service is a TEST FIXTURE: token -> identity table at the authServiceClient boundary). fitness-service's own PT
 * surface (coach.service.ts getClientProgress) was already ACTIVE-only and is not touched.
 */

// The retired switch. Tests set it to every value to prove it no longer changes anything.
const FLAG = "INBODY_PT_ACCESS_ACTIVE_ONLY";
const createdContracts: string[] = [];
const createdClients: string[] = [];

async function seed(ptUserId: string, clientUserId: string, status: ContractStatus) {
  const row = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId, clientUserId, packageName: "Seed", totalSessions: 10, price: 1_000_000, status },
  });
  createdContracts.push(row.id);
}
async function seedInBody(userId: string, n = 2) {
  createdClients.push(userId);
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i));
    await prisma.inBodyEntry.create({ data: { userId, date: day, dateOnly: day, weight: 70 + i, bodyFat: 14, muscleMass: 30 } });
  }
}

function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  });
}

const identities = new Map<string, { id: string; email: string; role: string }>();
const orig = authServiceClient.verifyToken;
let server: http.Server;
let base = "";
dbTest.before(async () => {
  if (skip) return;
  authServiceClient.verifyToken = (async (header: string) => {
    const user = identities.get(String(header).replace(/^Bearer /, ""));
    if (!user) throw Object.assign(new Error("bad"), { response: { status: 401, data: {} } });
    return { status: 200, data: { user } };
  }) as typeof authServiceClient.verifyToken;
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
dbTest.after(async () => {
  authServiceClient.verifyToken = orig;
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  await prisma.inBodyEntry.deleteMany({ where: { userId: { in: createdClients } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } });
  await prisma.$disconnect();
});

const forbidden = (e: any) => e?.status === 403;

dbTest("PT may read the client's InBody history while the contract is ACTIVE", async () => {
  const pt = randomUUID();
  const client = randomUUID();
  await seedInBody(client);
  await seed(pt, client, ContractStatus.ACTIVE);
  await withFlag(undefined, async () => {
    const history = await inbodyService.getClientHistory(pt, client);
    assert.equal(history.length, 2);
  });
});

dbTest("COMPLETED, CANCELLED, EXPIRED, REJECTED and every never-active state are 403 - nothing is deleted", async () => {
  const pt = randomUUID();
  const client = randomUUID();
  await seedInBody(client);
  // one live contract per pair (unique index), so the history states are stacked here and the live ones are tried one by one below
  const statuses = [
    ContractStatus.COMPLETED, ContractStatus.CANCELLED, ContractStatus.EXPIRED, ContractStatus.REJECTED,
    ContractStatus.PENDING_REVIEW, ContractStatus.PENDING_SIGNATURE, ContractStatus.PENDING_PAYMENT,
  ];
  for (const status of statuses.slice(0, 4)) await seed(pt, client, status);
  await withFlag(undefined, async () => {
    await assert.rejects(() => inbodyService.getClientHistory(pt, client), forbidden);
  });
  assert.equal(await prisma.inBodyEntry.count({ where: { userId: client } }), 2, "the client's InBody data is untouched");
  // and each state on its own (a client with a single contract in that state)
  for (const status of statuses) {
    const c = randomUUID();
    await seedInBody(c, 1);
    await seed(pt, c, status);
    await withFlag(undefined, () => assert.rejects(() => inbodyService.getClientHistory(pt, c), forbidden, String(status)));
  }
});

dbTest("a PT with no contract with THIS client is 403, even when they have an ACTIVE contract with someone else", async () => {
  const ptA = randomUUID();
  const ptB = randomUUID();
  const client = randomUUID();
  await seedInBody(client);
  await seed(ptA, client, ContractStatus.ACTIVE);
  await seed(ptB, randomUUID(), ContractStatus.ACTIVE);
  await withFlag(undefined, () => assert.rejects(() => inbodyService.getClientHistory(ptB, client), forbidden));
  await withFlag("false", () => assert.rejects(() => inbodyService.getClientHistory(ptB, client), forbidden));
});

dbTest("the client always reads their own history (no contract needed)", async () => {
  const client = randomUUID();
  await seedInBody(client, 3);
  for (const v of [undefined, "true", "false"]) {
    await withFlag(v, async () => assert.equal((await inbodyService.getHistory(client)).length, 3));
  }
});

dbTest("the retired INBODY_PT_ACCESS_ACTIVE_ONLY variable is inert: with it set to false (or anything) COMPLETED / CANCELLED / EXPIRED / REJECTED / pending are STILL 403", async () => {
  const pt = randomUUID();
  const done = randomUUID();
  await seedInBody(done);
  await seed(pt, done, ContractStatus.COMPLETED);
  for (const v of ["false", "FALSE", "true", "", "0", undefined]) {
    await withFlag(v, () => assert.rejects(() => inbodyService.getClientHistory(pt, done), forbidden, `COMPLETED with value ${JSON.stringify(v)} must stay 403`));
  }
  for (const status of [ContractStatus.CANCELLED, ContractStatus.EXPIRED, ContractStatus.REJECTED, ContractStatus.PENDING_PAYMENT]) {
    const c = randomUUID();
    await seedInBody(c, 1);
    await seed(pt, c, status);
    await withFlag("false", () => assert.rejects(() => inbodyService.getClientHistory(pt, c), forbidden, String(status)));
  }
  assert.equal(await prisma.inBodyEntry.count({ where: { userId: done } }), 2, "nothing was deleted");
});

dbTest("the BR-32 fallback code is gone: no flag helper in the service, no ACTIVE-or-COMPLETED lookup in the repository", async () => {
  const { contractRepository } = await import("../repositories/contract.repository");
  assert.equal((inbodyService as any).inbodyPtAccessActiveOnly, undefined);
  assert.equal(("inbodyPtAccessActiveOnly" in (await import("../services/inbody.service"))), false);
  assert.equal((contractRepository as any).findActiveOrCompletedByPair, undefined);
});

async function get(p: string, token: string) {
  const res = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

dbTest("REAL HTTP GET /inbody/client/:id: ACTIVE 200; COMPLETED 403 (also with the retired flag set to false); other PT 403; client reads /inbody", async () => {
  const pt = randomUUID();
  const other = randomUUID();
  const active = randomUUID();
  const done = randomUUID();
  await seedInBody(active);
  await seedInBody(done);
  await seed(pt, active, ContractStatus.ACTIVE);
  await seed(pt, done, ContractStatus.COMPLETED);
  const tok = (id: string, role: string) => {
    const t = `tok-${id}`;
    identities.set(t, { id, email: `${id}@test.local`, role });
    return t;
  };
  const ptTok = tok(pt, "PT");
  await withFlag(undefined, async () => {
    const a = await get(`/inbody/client/${active}`, ptTok);
    assert.equal(a.status, 200);
    assert.equal(a.body.length, 2);
    assert.equal((await get(`/inbody/client/${done}`, ptTok)).status, 403);
    assert.equal((await get(`/inbody/client/${active}`, tok(other, "PT"))).status, 403);
    const own = await get(`/inbody`, tok(active, "CUSTOMER"));
    assert.equal(own.status, 200);
    assert.equal(own.body.length, 2);
  });
  await withFlag("false", async () => {
    assert.equal((await get(`/inbody/client/${done}`, ptTok)).status, 403, "the retired flag changes nothing");
    assert.equal((await get(`/inbody/client/${active}`, ptTok)).status, 200);
  });
});
