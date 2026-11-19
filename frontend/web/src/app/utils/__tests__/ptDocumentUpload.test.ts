/**
 * N13B-09: PT application upload reasons.
 * Run: npx tsx --test src/app/utils/__tests__/ptDocumentUpload.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkPtDocumentFile,
  ptDocumentUploadErrorMessage,
  PT_DOCUMENT_SIZE_MESSAGE,
  PT_DOCUMENT_TYPE_MESSAGE,
} from "../ptDocumentUpload";

const http = (status: number, error?: string) => ({ response: { status, data: error ? { error } : {} } });

describe("checkPtDocumentFile", () => {
  it("accepts JPG/PNG/PDF within 10 MB", () => {
    assert.equal(checkPtDocumentFile({ name: "a.JPG", type: "image/jpeg", size: 1000 }), null);
    assert.equal(checkPtDocumentFile({ name: "b.pdf", type: "application/pdf", size: 10 * 1024 * 1024 }), null);
    assert.equal(checkPtDocumentFile({ name: "c.png", type: "", size: 5 }), null);
  });
  it("rejects a wrong type", () => {
    assert.equal(checkPtDocumentFile({ name: "a.docx", type: "application/msword", size: 10 }), PT_DOCUMENT_TYPE_MESSAGE);
    assert.equal(checkPtDocumentFile({ name: "a.gif", type: "image/gif", size: 10 }), PT_DOCUMENT_TYPE_MESSAGE);
  });
  it("rejects an oversize file with the limit in the text", () => {
    const m = checkPtDocumentFile({ name: "a.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1 });
    assert.equal(m, PT_DOCUMENT_SIZE_MESSAGE);
    assert.match(m!, /10 MB/);
  });
});

describe("ptDocumentUploadErrorMessage", () => {
  it("413 -> size reason", () => {
    assert.equal(ptDocumentUploadErrorMessage(http(413, "File too large. Maximum allowed size is 10 MB.")), PT_DOCUMENT_SIZE_MESSAGE);
  });
  it("400 wrong type (multipart and presign wording) -> type reason", () => {
    assert.equal(ptDocumentUploadErrorMessage(http(400, "Only .png, .jpg, .jpeg and .pdf formats are allowed")), PT_DOCUMENT_TYPE_MESSAGE);
    assert.equal(ptDocumentUploadErrorMessage(http(400, "contentType must be one of: image/jpeg, image/png, application/pdf")), PT_DOCUMENT_TYPE_MESSAGE);
  });
  it("network error and web-side Vietnamese error", () => {
    assert.match(ptDocumentUploadErrorMessage(new Error("Network Error")), /Không kết nối/);
    assert.equal(ptDocumentUploadErrorMessage(new Error("File quá lớn. Giới hạn tối đa 10 MB.")), "File quá lớn. Giới hạn tối đa 10 MB.");
  });
  it("401 / 500 are Vietnamese, never English", () => {
    assert.match(ptDocumentUploadErrorMessage(http(401)), /đăng nhập/);
    assert.match(ptDocumentUploadErrorMessage(http(500, "Internal")), /Tải lên thất bại/);
  });
});
