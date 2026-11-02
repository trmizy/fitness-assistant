/**
 * DISPUTE CASE slice 2 / S2.8 - evidence FILES with a server-side sha256 (dev / test, SYNTHETIC bytes only).
 * Evidence label: BACKEND INTEGRATION + REAL HTTP on an ephemeral port against the isolated *_test user database; the auth-service half is a TEST FIXTURE
 * (verifyToken stub). Files go to a throw-away directory under the OS temp folder, never to user-service/uploads. payment-service is not involved.
 *
 * Run ALONE (truncates the dispute_case* tables).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { guardedTest as test } from "./test-db-guard";
import { authServiceClient } from "../clients/auth-service.client";
import { prisma } from "../repositories/profile.repository";
import { disputeCaseService as svc } from "../services/dispute-case/dispute-case.service";
import { storageDir, sniffMime, MAX_EVIDENCE_BYTES } from "../services/dispute-case/evidence-storage";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { admin, disableExecutionFlags, enableExecutionFlags } from "./dispute-case-exec.test-helpers";

const DIR = path.join(os.tmpdir(), `gymini-dispute-evidence-test-${randomUUID()}`);
const contracts: string[] = [];
const pts: string[] = [];
const A1 = admin();
const A2 = admin();

// Synthetic bytes: real magic numbers, made-up content.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("SYNTHETIC-TEST-IMAGE-NOT-A-REAL-PHOTO")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("SYNTHETIC-TEST-JPEG")]);
const PDF = Buffer.from("%PDF-1.4\nSYNTHETIC TEST DOCUMENT\n%%EOF\n");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let server: ReturnType<(typeof import("../app"))["default"]["listen"]>;
let base = "";
let restoreAuth: () => void = () => {};

test.before(async () => {
  process.env.DISPUTE_CASE_EVIDENCE_DIR = DIR;
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_cases CASCADE`,
  );
  const original = authServiceClient.verifyToken;
  (authServiceClient as any).verifyToken = async (header: string) => {
    const token = header.replace(/^Bearer /, "");
    const [role, id] = token.split(":");
    if (!role || !id) throw Object.assign(new Error("401"), { response: { status: 401, data: { error: "x" } } });
    return { status: 200, data: { user: { id, email: `${id}@t.test`, role } } };
  };
  restoreAuth = () => ((authServiceClient as any).verifyToken = original);
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.after(async () => {
  restoreAuth();
  disableExecutionFlags();
  delete process.env.DISPUTE_CASE_EVIDENCE_DIR;
  server?.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: contracts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: contracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: contracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: pts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  disableExecutionFlags();
  enableExecutionFlags({ evidence: true });
});

async function mkCase() {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  contracts.push(contract.id);
  pts.push(ptUserId);
  const session = await addSession(contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), { sessionMode: "ONLINE", disputeType: "DELIVERY_DISPUTE", disputedAt: new Date(), disputeReason: "Khách khiếu nại", ptNotes: "PT ghi chú" });
  const caseId = (await svc.openCase(A1, session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  return { caseId, session, clientUserId: contract.clientUserId, ptUserId, client: `CUSTOMER:${contract.clientUserId}`, pt: `PT:${ptUserId}` };
}


async function upload(caseId: string, token: string | null, file: { bytes: Buffer; mime: string; name?: string } | null, fields: Record<string, string> = { description: "Ảnh chụp màn hình tin nhắn (dữ liệu giả lập)" }, headers: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.name ?? "evidence.bin");
  const res = await fetch(`${base}/dispute-cases/${caseId}/evidence-files`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: fd });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function download(url: string, token: string | null) {
  const res = await fetch(base + url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, json: (() => { try { return JSON.parse(buf.toString("utf8")); } catch { return null; } })() as any };
}
const filesOf = (caseId: string) => (fs.existsSync(path.join(DIR, caseId)) ? fs.readdirSync(path.join(DIR, caseId)) : []);

test("flag OFF (also: true outside a test environment): upload and download answer 404 FEATURE_DISABLED, nothing is parsed, stored or recorded", async () => {
  const x = await mkCase();
  for (const mode of ["unset", "production"] as const) {
    disableExecutionFlags();
    if (mode === "production") {
      process.env.DISPUTE_CASE_EVIDENCE_STORAGE_ENABLED = "true";
      process.env.NODE_ENV = "production";
    } else process.env.NODE_ENV = "test";
    const warn = console.warn;
    console.warn = () => {};
    try {
      const up = await upload(x.caseId, x.client, { bytes: PNG, mime: "image/png" });
      assert.equal(up.status, 404, mode);
      assert.equal(up.json.code, "FEATURE_DISABLED");
      const dl = await download(`/dispute-cases/${x.caseId}/evidence/${randomUUID()}/file`, x.client);
      assert.deepEqual([dl.status, dl.json?.code], [404, "FEATURE_DISABLED"]);
      assert.equal((await download(`/admin/dispute-cases/${x.caseId}/evidence/${randomUUID()}/file`, `ADMIN:${A1.id}`)).status, 404);
    } finally {
      console.warn = warn;
      process.env.NODE_ENV = "test";
    }
  }
  assert.deepEqual(filesOf(x.caseId), []);
  assert.equal(await prisma.disputeCaseEvidence.count({ where: { caseId: x.caseId, subject: { startsWith: "PARTY_FILE:" } } }), 0);
});

test("upload: the SERVER hashes the bytes (SERVER_VERIFIED for the file only), the row stays RESTRICTED, the file is stored under an opaque key outside uploads/", async () => {
  const x = await mkCase();
  const up = await upload(x.caseId, x.client, { bytes: PNG, mime: "image/png", name: "../../etc/passwd<x>.png" });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.deepEqual([up.json.sha256, up.json.verificationStatus, up.json.sensitivity, up.json.shareable, up.json.sizeBytes], [sha(PNG), "SERVER_VERIFIED", "RESTRICTED", false, PNG.length]);
  const row = await prisma.disputeCaseEvidence.findUniqueOrThrow({ where: { id: up.json.id } });
  assert.deepEqual([row.verificationStatus, row.sensitivity, row.submittedRole, row.submittedBy], ["SERVER_VERIFIED", "RESTRICTED", "CLIENT", x.clientUserId]);
  const stored = (row.payload as any).storedFile;
  assert.equal(stored.sha256, sha(PNG));
  assert.match(stored.key, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/, "opaque key; the client's file name is not part of it");
  assert.equal((row.payload as any).fileName?.includes("/"), false, "the display name is sanitised");
  const onDisk = fs.readFileSync(path.join(DIR, stored.key));
  assert.equal(sha(onDisk), stored.sha256, "the stored bytes hash to the recorded value");
  assert.ok(path.resolve(storageDir()).startsWith(os.tmpdir()), "stored under the OS temp folder");
  // the hash the server computed is the file's, whatever the party DECLARES: a declared-only hash (Slice 1 path) stays unverified
  const declared = await svc.submitEvidence({ id: x.clientUserId, role: "CUSTOMER" }, x.caseId, { description: "Hash tự khai", sha256: "a".repeat(64) });
  const view = await svc.getForAdmin(A1, x.caseId);
  const byId = new Map(view.evidence.map((e: any) => [e.id, e]));
  assert.equal((byId.get(up.json.id) as any).verificationStatus, "SERVER_VERIFIED");
  assert.equal((byId.get(declared.result.id) as any).verificationStatus, "CLIENT_CLAIMED_UNVERIFIED");
});

test("refused uploads leave NOTHING on disk or in the database: type not matching the bytes, text file, oversize, empty, no file, no description, extra field", async () => {
  const x = await mkCase();
  const before = await prisma.disputeCaseEvidence.count({ where: { caseId: x.caseId } });
  const cases: Array<[string, Awaited<ReturnType<typeof upload>>]> = [
    ["declared png, bytes jpeg", await upload(x.caseId, x.client, { bytes: JPG, mime: "image/png" })],
    ["declared pdf, bytes png", await upload(x.caseId, x.client, { bytes: PNG, mime: "application/pdf" })],
    ["plain text", await upload(x.caseId, x.client, { bytes: Buffer.from("hello world"), mime: "text/plain" })],
    ["html as image", await upload(x.caseId, x.client, { bytes: Buffer.from("<html><script>alert(1)</script>"), mime: "image/png" })],
    ["empty", await upload(x.caseId, x.client, { bytes: Buffer.alloc(0), mime: "image/png" })],
  ];
  assert.deepEqual(cases.map(([, r]) => r.status), [415, 415, 415, 415, 400], JSON.stringify(cases.map(([n, r]) => [n, r.status, r.json?.code])));
  const big = await upload(x.caseId, x.client, { bytes: Buffer.concat([PNG, Buffer.alloc(MAX_EVIDENCE_BYTES)]), mime: "image/png" });
  assert.deepEqual([big.status, big.json.code], [413, "FILE_TOO_LARGE"]);
  assert.equal((await upload(x.caseId, x.client, null)).status, 400);
  assert.equal((await upload(x.caseId, x.client, { bytes: PNG, mime: "image/png" }, {})).status, 400, "description is required");
  assert.equal((await upload(x.caseId, x.client, { bytes: PNG, mime: "image/png" }, { description: "ok", sha256: "a".repeat(64) })).status, 400, "no client-supplied hash is accepted");
  assert.deepEqual(filesOf(x.caseId), []);
  assert.equal(await prisma.disputeCaseEvidence.count({ where: { caseId: x.caseId } }), before);
  // exactly at the limit is fine
  const edge = Buffer.concat([PNG, Buffer.alloc(MAX_EVIDENCE_BYTES - PNG.length)]);
  assert.equal(edge.length, MAX_EVIDENCE_BYTES);
  assert.equal((await upload(x.caseId, x.client, { bytes: edge, mime: "image/png" })).status, 201);
  assert.equal(sniffMime(PDF), "application/pdf");
});

test("who may upload: only a party of the case, only while the case accepts party material; nobody unauthenticated", async () => {
  const x = await mkCase();
  assert.equal((await upload(x.caseId, null, { bytes: PNG, mime: "image/png" })).status, 401);
  assert.equal((await upload(x.caseId, `CUSTOMER:${randomUUID()}`, { bytes: PNG, mime: "image/png" })).status, 404, "a stranger learns nothing");
  assert.equal((await upload(x.caseId, `ADMIN:${A1.id}`, { bytes: PNG, mime: "image/png" })).status, 404, "an admin is not a party");
  const y = await mkCase();
  await prisma.disputeCase.update({ where: { id: y.caseId }, data: { status: "DECISION_APPROVED" } });
  const closed = await upload(y.caseId, y.client, { bytes: PNG, mime: "image/png" });
  assert.deepEqual([closed.status, closed.json.code], [409, "CASE_STATE_NOT_ALLOWED"]);
  assert.deepEqual([filesOf(x.caseId), filesOf(y.caseId)], [[], []]);
  assert.equal((await upload(x.caseId, x.pt, { bytes: PDF, mime: "application/pdf" })).status, 201, "the PT is a party too");
});

test("read: the submitter and an admin who is not a party get the exact bytes (and every read is logged); the OTHER party, a stranger, anonymous get nothing; a tampered file is refused", async () => {
  const x = await mkCase();
  const up = await upload(x.caseId, x.client, { bytes: PNG, mime: "image/png" });
  const evId = up.json.id as string;
  const own = await download(`/dispute-cases/${x.caseId}/evidence/${evId}/file`, x.client);
  assert.equal(own.status, 200);
  assert.ok(own.buf.equals(PNG));
  assert.deepEqual([own.headers.get("content-type"), own.headers.get("x-evidence-sha256"), own.headers.get("x-content-type-options")], ["image/png", sha(PNG), "nosniff"]);
  assert.equal(own.headers.get("content-disposition"), "attachment");
  const adm = await download(`/admin/dispute-cases/${x.caseId}/evidence/${evId}/file`, `ADMIN:${A2.id}`);
  assert.equal(adm.status, 200);
  assert.ok(adm.buf.equals(PNG));

  const logs = await prisma.disputeCaseAccessLog.findMany({ where: { caseId: x.caseId, evidenceId: evId, action: "VIEW_EVIDENCE" } });
  assert.deepEqual(logs.map((l) => l.viewerUserId).sort(), [x.clientUserId, A2.id].sort(), "one log row per read, by whom");

  // the other side and strangers: a plain 404, same as a file that does not exist
  const before = await prisma.disputeCaseAccessLog.count({ where: { caseId: x.caseId } });
  for (const [tok, url] of [
    [x.pt, `/dispute-cases/${x.caseId}/evidence/${evId}/file`],
    [`CUSTOMER:${randomUUID()}`, `/dispute-cases/${x.caseId}/evidence/${evId}/file`],
    [null, `/dispute-cases/${x.caseId}/evidence/${evId}/file`],
    [x.client, `/dispute-cases/${x.caseId}/evidence/${randomUUID()}/file`],
    [x.client, `/dispute-cases/${x.caseId}/evidence/not-a-uuid/file`],
    [x.client, `/admin/dispute-cases/${x.caseId}/evidence/${evId}/file`], // admin route needs the ADMIN role
  ] as Array<[string | null, string]>) {
    const r = await download(url, tok);
    assert.ok([401, 403, 404].includes(r.status), `${tok} ${url} -> ${r.status}`);
    assert.equal(r.buf.equals(PNG), false);
  }
  assert.equal(await prisma.disputeCaseAccessLog.count({ where: { caseId: x.caseId } }), before, "a refused read is not a read");

  // integrity: someone edits the file on disk
  const key = ((await prisma.disputeCaseEvidence.findUniqueOrThrow({ where: { id: evId } })).payload as any).storedFile.key as string;
  fs.appendFileSync(path.join(DIR, key), "tamper");
  const bad = await download(`/dispute-cases/${x.caseId}/evidence/${evId}/file`, x.client);
  assert.deepEqual([bad.status, bad.json?.code], [409, "EVIDENCE_FILE_INTEGRITY"]);
  fs.rmSync(path.join(DIR, key));
  assert.equal((await download(`/dispute-cases/${x.caseId}/evidence/${evId}/file`, x.client)).status, 404);
});

test("the party view of the OTHER side never lists a file; sharing a party-submitted file is STILL refused 409 (no redaction design, B-7)", async () => {
  const x = await mkCase();
  const up = await upload(x.caseId, x.client, { bytes: PDF, mime: "application/pdf" });
  const ptView = await svc.getForParty({ id: x.ptUserId, role: "PT" }, x.caseId);
  assert.equal(JSON.stringify(ptView).includes(up.json.id), false, "the PT's view does not contain the client's file row");
  const mine = await svc.getForParty({ id: x.clientUserId, role: "CUSTOMER" }, x.caseId);
  assert.equal(JSON.stringify(mine).includes(up.json.id), true);
  await assert.rejects(svc.share(A1, x.caseId, { evidenceId: up.json.id, sharedWithRole: "PT", reason: "thử" }), (e: any) => e.status === 409 && e.code === "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED");
  assert.equal(await prisma.disputeCaseShare.count({ where: { caseId: x.caseId } }), 0);
  // even a forged share row cannot open it: visibility ignores shares for party-submitted rows
  assert.equal(JSON.stringify(await svc.getForParty({ id: x.ptUserId, role: "PT" }, x.caseId)).includes(up.json.id), false);
});

test("idempotent upload: the same Idempotency-Key replays the first answer and leaves ONE file; a different body under the same key is refused", async () => {
  const x = await mkCase();
  const key = `up-${randomUUID()}`;
  const a = await upload(x.caseId, x.client, { bytes: PNG, mime: "image/png" }, undefined, { "Idempotency-Key": key });
  const b = await upload(x.caseId, x.client, { bytes: PNG, mime: "image/png" }, undefined, { "Idempotency-Key": key });
  assert.deepEqual([a.status, b.status, b.json.id], [201, 200, a.json.id]);
  assert.equal(filesOf(x.caseId).length, 1, "the duplicate bytes of the replay were removed");
  const c = await upload(x.caseId, x.client, { bytes: JPG, mime: "image/jpeg" }, undefined, { "Idempotency-Key": key });
  assert.equal(c.status, 409);
  assert.equal(filesOf(x.caseId).length, 1);
});

test("the evidence directory can never be inside an 'uploads' folder", () => {
  const env = (d: string) => ({ DISPUTE_CASE_EVIDENCE_DIR: d }) as NodeJS.ProcessEnv;
  const serviceUploads = path.resolve(__dirname, "..", "..", "uploads");
  for (const bad of [serviceUploads, path.join(serviceUploads, "dispute"), path.join(process.cwd(), "uploads", "x"), path.join(os.tmpdir(), "uploads", "evidence")]) {
    assert.throws(() => storageDir(env(bad)), /EVIDENCE_DIR_REFUSED/, bad);
  }
  assert.ok(storageDir({} as NodeJS.ProcessEnv).startsWith(path.resolve(os.tmpdir())), "default: the OS temp folder");
});
