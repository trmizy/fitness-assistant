/**
 * Partner retest 2026-11-17 (BRANCHDOC-01): branch documents and complaint photos were written to local disk by multer, which
 * Lambda refuses (503). They now go presign -> POST to S3 -> confirm. Pure unit test: partnerS3 is stubbed, no DB, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_SERVICE_SECRET = "unit-test-secret-not-real";
delete process.env.PARTNER_S3_REQUIRE_SSE;

import { partnerS3 } from "../services/partner-s3.service";
import {
  EvidenceUploadError,
  contentTypeForToken,
  mayViewEvidence,
  privateEvidenceUpload,
} from "../services/private-evidence-upload.service";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0, 0, 0, 0, 0]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");

type Stub = {
  configured: boolean;
  head: { contentLength?: number; contentType?: string; serverSideEncryption?: string } | null;
  first: Uint8Array;
  presigned: Array<{ key: string; contentType: string; maxBytes: number }>;
  deleted: string[];
  gets: Array<{ key: string; contentType?: string; expiresSec?: number; attachment?: boolean }>;
};
const stub: Stub = { configured: true, head: null, first: JPEG, presigned: [], deleted: [], gets: [] };
const originals = { ...partnerS3 };

test.beforeEach(() => {
  stub.configured = true;
  stub.head = { contentLength: 2048, contentType: "image/jpeg", serverSideEncryption: "AES256" };
  stub.first = JPEG;
  stub.presigned = [];
  stub.deleted = [];
  stub.gets = [];
  (partnerS3 as any).isConfigured = () => stub.configured;
  (partnerS3 as any).presignUpload = async (p: any) => { stub.presigned.push(p); return { url: "https://bucket.example/upload", fields: { key: p.key, "Content-Type": p.contentType } }; };
  (partnerS3 as any).headObject = async () => stub.head;
  (partnerS3 as any).readHead = async () => stub.first;
  (partnerS3 as any).deleteObject = async (key: string) => { stub.deleted.push(key); };
  (partnerS3 as any).presignGet = async (p: any) => { stub.gets.push(p); return "https://bucket.example/get?sig=x"; };
});
test.after(() => Object.assign(partnerS3, originals));

const rejects = (fn: () => Promise<unknown>, status: number, code?: string) =>
  assert.rejects(fn, (e: any) => e instanceof EvidenceUploadError && e.status === status && (code === undefined || e.code === code));

test("presign complaint photo: key lives under complaint-photos/<userId>-..., policy carries type and 8 MB cap", async () => {
  const r = await privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/jpeg", sizeBytes: 500_000 });
  assert.equal(stub.presigned.length, 1);
  assert.match(stub.presigned[0].key, /^complaint-photos\/u1-\d+-[0-9a-f]{12}\.jpg$/);
  assert.equal(stub.presigned[0].maxBytes, 8 * 1024 * 1024);
  assert.equal(stub.presigned[0].contentType, "image/jpeg");
  assert.equal(r.method, "POST");
  assert.ok(r.uploadId.includes("."));
  assert.ok(new Date(r.expiresAt).getTime() > Date.now());
});

test("presign branch document: PDF accepted, key under branch-documents/, 10 MB cap", async () => {
  await privateEvidenceUpload.presign({ kind: "BRANCH_DOCUMENT", userId: "u1", contentType: "application/pdf", sizeBytes: 9_000_000, scope: "g1:LEASE_OR_PROPERTY_DOC" });
  assert.match(stub.presigned[0].key, /^branch-documents\/u1-\d+-[0-9a-f]{12}\.pdf$/);
  assert.equal(stub.presigned[0].maxBytes, 10 * 1024 * 1024);
});

test("presign refusals: wrong type, too large, bad size, storage not configured", async () => {
  await rejects(() => privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "application/pdf", sizeBytes: 10 }), 415, "UNSUPPORTED_TYPE");
  await rejects(() => privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/svg+xml", sizeBytes: 10 }), 415);
  await rejects(() => privateEvidenceUpload.presign({ kind: "BRANCH_DOCUMENT", userId: "u1", contentType: "text/html", sizeBytes: 10 }), 415);
  await rejects(() => privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/png", sizeBytes: 8 * 1024 * 1024 + 1 }), 413, "FILE_TOO_LARGE");
  await rejects(() => privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/png", sizeBytes: 0 }), 400, "INVALID_SIZE");
  await rejects(() => privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/png", sizeBytes: Number.NaN }), 400, "INVALID_SIZE");
  stub.configured = false;
  await rejects(() => privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/png", sizeBytes: 10 }), 503, "UPLOADS_UNAVAILABLE");
  assert.equal(stub.presigned.length, 0, "no S3 policy is signed for a refused request");
});

test("confirm returns the token of the object that was verified", async () => {
  const p = await privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/jpeg", sizeBytes: 2048 });
  const { token } = await privateEvidenceUpload.confirm({ kind: "COMPLAINT_PHOTO", userId: "u1", uploadId: p.uploadId });
  assert.equal(`complaint-photos/${token}`, stub.presigned[0].key);
  assert.ok(token.startsWith("u1-"));
  assert.equal(stub.deleted.length, 0);
});

test("confirm is bound to user, kind and scope; tampered or foreign upload ids are 404", async () => {
  const p = await privateEvidenceUpload.presign({ kind: "BRANCH_DOCUMENT", userId: "u1", contentType: "application/pdf", sizeBytes: 100, scope: "g1:LEASE_OR_PROPERTY_DOC" });
  stub.head = { contentLength: 100, contentType: "application/pdf", serverSideEncryption: "AES256" };
  stub.first = PDF;
  const ok = { kind: "BRANCH_DOCUMENT" as const, userId: "u1", uploadId: p.uploadId, scope: "g1:LEASE_OR_PROPERTY_DOC" };
  assert.ok((await privateEvidenceUpload.confirm(ok)).token);
  await rejects(() => privateEvidenceUpload.confirm({ ...ok, userId: "u2" }), 404, "NOT_FOUND");
  await rejects(() => privateEvidenceUpload.confirm({ ...ok, kind: "COMPLAINT_PHOTO" }), 404, "NOT_FOUND");
  await rejects(() => privateEvidenceUpload.confirm({ ...ok, scope: "g2:LEASE_OR_PROPERTY_DOC" }), 404, "NOT_FOUND");
  await rejects(() => privateEvidenceUpload.confirm({ ...ok, scope: "g1:FACILITY_PHOTOS" }), 404, "NOT_FOUND");
  const [body, mac] = p.uploadId.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "u2" })).toString("base64url");
  await rejects(() => privateEvidenceUpload.confirm({ ...ok, userId: "u2", uploadId: `${forgedBody}.${mac}` }), 404, "NOT_FOUND");
  await rejects(() => privateEvidenceUpload.confirm({ ...ok, uploadId: `${body}.${mac.slice(0, -2)}AA` }), 404, "NOT_FOUND");
  for (const junk of [undefined, null, 42, "", "abc", "a.b.c", "x".repeat(5000)]) {
    await rejects(() => privateEvidenceUpload.confirm({ ...ok, uploadId: junk }), 404, "NOT_FOUND");
  }
});

test("confirm: expired intent is 410", async () => {
  const p = await privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/jpeg", sizeBytes: 100 });
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    await rejects(() => privateEvidenceUpload.confirm({ kind: "COMPLAINT_PHOTO", userId: "u1", uploadId: p.uploadId }), 410, "UPLOAD_EXPIRED");
  } finally {
    Date.now = realNow;
  }
});

test("confirm: nothing uploaded -> 409 and nothing is deleted", async () => {
  const p = await privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/jpeg", sizeBytes: 100 });
  stub.head = null;
  await rejects(() => privateEvidenceUpload.confirm({ kind: "COMPLAINT_PHOTO", userId: "u1", uploadId: p.uploadId }), 409, "UPLOAD_NOT_FOUND");
  assert.equal(stub.deleted.length, 0);
});

test("confirm: HTML named as a photo, a PNG declared as JPEG, an oversized or empty object are rejected AND deleted", async () => {
  const cases: Array<[string, () => void]> = [
    ["html bytes", () => { stub.first = HTML; }],
    ["png declared jpeg", () => { stub.first = PNG; }],
    ["oversized", () => { stub.head = { contentLength: 9 * 1024 * 1024, contentType: "image/jpeg", serverSideEncryption: "AES256" }; }],
    ["empty", () => { stub.head = { contentLength: 0, contentType: "image/jpeg", serverSideEncryption: "AES256" }; }],
    ["content-type differs from the declared one", () => { stub.head = { contentLength: 100, contentType: "text/html", serverSideEncryption: "AES256" }; }],
  ];
  for (const [name, mutate] of cases) {
    stub.deleted = [];
    stub.head = { contentLength: 2048, contentType: "image/jpeg", serverSideEncryption: "AES256" };
    stub.first = JPEG;
    const p = await privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/jpeg", sizeBytes: 100 });
    mutate();
    await rejects(() => privateEvidenceUpload.confirm({ kind: "COMPLAINT_PHOTO", userId: "u1", uploadId: p.uploadId }), 422, "UPLOAD_REJECTED");
    assert.deepEqual(stub.deleted, [stub.presigned[stub.presigned.length - 1].key], `${name}: the rejected object is removed from the bucket`);
  }
});

test("confirm: with PARTNER_S3_REQUIRE_SSE an unencrypted object is rejected and deleted", async () => {
  process.env.PARTNER_S3_REQUIRE_SSE = "true";
  try {
    const p = await privateEvidenceUpload.presign({ kind: "COMPLAINT_PHOTO", userId: "u1", contentType: "image/jpeg", sizeBytes: 100 });
    stub.head = { contentLength: 100, contentType: "image/jpeg" };
    await rejects(() => privateEvidenceUpload.confirm({ kind: "COMPLAINT_PHOTO", userId: "u1", uploadId: p.uploadId }), 422, "UPLOAD_REJECTED");
    assert.equal(stub.deleted.length, 1);
  } finally {
    delete process.env.PARTNER_S3_REQUIRE_SSE;
  }
});

test("view rule is unchanged: own upload, or ADMIN only when the token is attached", async () => {
  const never = async () => { throw new Error("isAttached must not be asked"); };
  assert.equal(await mayViewEvidence({ token: "u1-1-ab.jpg", requester: { userId: "u1", role: "CUSTOMER" }, isAttached: never }), "OK");
  assert.equal(await mayViewEvidence({ token: "u1-1-ab.jpg", requester: { userId: "u2", role: "CUSTOMER" }, isAttached: never }), "FORBIDDEN");
  assert.equal(await mayViewEvidence({ token: "u1-1-ab.jpg", requester: { userId: "u2", role: "PT" }, isAttached: never }), "FORBIDDEN");
  assert.equal(await mayViewEvidence({ token: "u1-1-ab.jpg", requester: { userId: "a1", role: "ADMIN" }, isAttached: async () => true }), "OK");
  assert.equal(await mayViewEvidence({ token: "u1-1-ab.jpg", requester: { userId: "a1", role: "ADMIN" }, isAttached: async () => false }), "FORBIDDEN");
  // a user id that is a prefix of another must not match ("12-" is not "123-")
  assert.equal(await mayViewEvidence({ token: "123-1-ab.jpg", requester: { userId: "12", role: "CUSTOMER" }, isAttached: never }), "FORBIDDEN");
  for (const bad of ["../x.jpg", "a/b.jpg", "a b.jpg", "x%2e.jpg", ""]) {
    assert.equal(await mayViewEvidence({ token: bad, requester: { userId: "u1", role: "ADMIN" }, isAttached: async () => true }), "BAD_TOKEN", bad);
  }
});

test("viewUrl asks for a short-lived inline GET with the content type taken from the token extension", async () => {
  const v = await privateEvidenceUpload.viewUrl("BRANCH_DOCUMENT", "u1-1-ab.pdf");
  assert.equal(stub.gets[0].key, "branch-documents/u1-1-ab.pdf");
  assert.equal(stub.gets[0].contentType, "application/pdf");
  assert.equal(stub.gets[0].attachment, false);
  assert.equal(stub.gets[0].expiresSec, 120);
  assert.deepEqual(v, { url: "https://bucket.example/get?sig=x", expiresInSec: 120, contentType: "application/pdf" });
  assert.equal(contentTypeForToken("a.jpeg"), "image/jpeg");
  assert.equal(contentTypeForToken("a.html"), undefined);
});
