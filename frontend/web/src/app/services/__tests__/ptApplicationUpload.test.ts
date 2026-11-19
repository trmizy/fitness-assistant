/**
 * PT application document upload: presign first, multipart fallback ONLY when the backend has no upload bucket.
 * Evidence label: TEST FIXTURE (api.post and fetch are stubbed; no request leaves the process).
 * Run: npx tsx --test src/app/services/__tests__/ptApplicationUpload.test.ts (from frontend/web)
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import api from "../api";
import { isUploadStorageNotConfigured, ptApplicationService } from "../ptApplicationService";

interface Call {
  url: string;
  body: any;
  config?: any;
}

const realPost = api.post;
const realFetch = globalThis.fetch;
let calls: Call[];
let fetchCalls: { url: string; init: any }[];

function stub(handler: (url: string, body: any) => any) {
  (api as any).post = async (url: string, body?: any, config?: any) => {
    calls.push({ url, body, config });
    return handler(url, body);
  };
}

function httpError(status: number, data: any) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });
}

const file = new File(["%PDF-1.4 fixture"], "cccd.pdf", { type: "application/pdf" });
const target = { uploadUrl: "https://bucket.example/put", key: "pt-applications/u1/doc.pdf", maxBytes: 10 * 1024 * 1024 };

beforeEach(() => {
  calls = [];
  fetchCalls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    fetchCalls.push({ url: String(url), init });
    return { ok: true } as Response;
  }) as typeof fetch;
});

afterEach(() => {
  (api as any).post = realPost;
  globalThis.fetch = realFetch;
});

describe("ptApplicationService.uploadDocument", () => {
  it("presign success: presign -> PUT -> confirm, no multipart", async () => {
    stub((url) => {
      if (url.endsWith("/presign")) return { data: target };
      if (url.endsWith("/confirm")) return { data: { key: target.key, url: "/uploads/doc.pdf", previewUrl: "/uploads/doc.pdf?sig=1" } };
      throw new Error(`unexpected ${url}`);
    });
    const out = await ptApplicationService.uploadDocument(file);
    assert.deepEqual(calls.map((c) => c.url), [
      "/pt-applications/me/upload/presign",
      "/pt-applications/me/upload/confirm",
    ]);
    assert.deepEqual(calls[0].body, { contentType: "application/pdf" });
    assert.deepEqual(calls[1].body, { key: target.key });
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, target.uploadUrl);
    assert.equal(fetchCalls[0].init.method, "PUT");
    assert.equal(out.url, "/uploads/doc.pdf");
    assert.equal(out.previewUrl, "/uploads/doc.pdf?sig=1");
    assert.equal(out.filename, "cccd.pdf");
  });

  it("503 UPLOAD_STORAGE_NOT_CONFIGURED: falls back to multipart with field 'document', same return shape", async () => {
    stub((url) => {
      if (url.endsWith("/presign"))
        throw httpError(503, { error: "USER_UPLOAD_BUCKET is not configured", code: "UPLOAD_STORAGE_NOT_CONFIGURED" });
      if (url === "/pt-applications/me/upload")
        return { data: { url: "/uploads/pt-applications/x.pdf", previewUrl: "/p?sig=1", filename: "x.pdf" } };
      throw new Error(`unexpected ${url}`);
    });
    const out = await ptApplicationService.uploadDocument(file);
    assert.deepEqual(calls.map((c) => c.url), [
      "/pt-applications/me/upload/presign",
      "/pt-applications/me/upload",
    ]);
    const form = calls[1].body as FormData;
    assert.ok(form instanceof FormData);
    assert.equal((form.get("document") as File).name, "cccd.pdf");
    assert.equal(fetchCalls.length, 0, "no direct PUT in the fallback path");
    assert.deepEqual(out, { url: "/uploads/pt-applications/x.pdf", previewUrl: "/p?sig=1", filename: "cccd.pdf" });
  });

  it("503 with only the English message (no code) also falls back", async () => {
    stub((url) => {
      if (url.endsWith("/presign")) throw httpError(503, { error: "USER_UPLOAD_BUCKET is not configured" });
      return { data: { url: "/u/y.pdf" } };
    });
    const out = await ptApplicationService.uploadDocument(file);
    assert.equal(calls[1].url, "/pt-applications/me/upload");
    assert.equal(out.url, "/u/y.pdf");
  });

  it("any other presign error still throws and never reaches multipart", async () => {
    const cases = [
      httpError(400, { error: "Loại tệp không hợp lệ" }),
      httpError(500, { error: "Lỗi hệ thống" }),
      httpError(503, { error: "Service temporarily unavailable" }), // 503 but not the bucket refusal
      httpError(401, { error: "USER_UPLOAD_BUCKET is not configured" }), // right text, wrong status
      new Error("Network Error"),
    ];
    for (const err of cases) {
      calls = [];
      stub(() => {
        throw err;
      });
      await assert.rejects(ptApplicationService.uploadDocument(file), (e) => e === err);
      assert.equal(calls.length, 1, "only the presign call was made");
    }
  });

  it("errors in the multipart fallback itself propagate", async () => {
    const err = httpError(413, { error: "File too large. Maximum allowed size is 10 MB." });
    stub((url) => {
      if (url.endsWith("/presign")) throw httpError(503, { code: "UPLOAD_STORAGE_NOT_CONFIGURED", error: "x is not configured" });
      throw err;
    });
    await assert.rejects(ptApplicationService.uploadDocument(file), (e) => e === err);
  });
});

describe("isUploadStorageNotConfigured", () => {
  it("only true for the 503 bucket refusal", () => {
    assert.equal(isUploadStorageNotConfigured(httpError(503, { code: "UPLOAD_STORAGE_NOT_CONFIGURED" })), true);
    assert.equal(isUploadStorageNotConfigured(httpError(503, { error: "X is not configured" })), true);
    assert.equal(isUploadStorageNotConfigured(httpError(500, { error: "X is not configured" })), false);
    assert.equal(isUploadStorageNotConfigured(undefined), false);
  });
});
