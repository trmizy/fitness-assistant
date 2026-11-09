/** Real evidence files (S2.8, 08/11): client-side checks, payload reading, upload/download wire shape. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDisputeCaseApi, type DisputeHttpClient } from "../disputes/disputeCaseApi";
import { downloadName, MAX_EVIDENCE_FILE_BYTES, storedFileOf, validateEvidenceFile, validateEvidenceFileText } from "../disputes/evidenceFileModel";
import { parseDisputeError } from "../disputes/disputeCaseErrors";

describe("validateEvidenceFile", () => {
  it("accepts the four server types up to 5 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) assert.equal(validateEvidenceFile({ name: "a", size: 10, type }).ok, true);
    assert.equal(validateEvidenceFile({ name: "a", size: MAX_EVIDENCE_FILE_BYTES, type: "application/pdf" }).ok, true);
  });
  it("refuses no file, empty, too big and other types", () => {
    assert.equal(validateEvidenceFile(null).ok, false);
    assert.equal(validateEvidenceFile({ name: "a", size: 0, type: "image/png" }).ok, false);
    assert.equal(validateEvidenceFile({ name: "a", size: MAX_EVIDENCE_FILE_BYTES + 1, type: "image/png" }).ok, false);
    assert.equal(validateEvidenceFile({ name: "a.gif", size: 10, type: "image/gif" }).ok, false);
    assert.equal(validateEvidenceFile({ name: "a.docx", size: 10, type: "" }).ok, false);
  });
});

describe("validateEvidenceFileText", () => {
  it("description is required (1..2000), title optional (<=200)", () => {
    assert.ok(validateEvidenceFileText("  ", "").description);
    assert.ok(validateEvidenceFileText("x".repeat(2001), "").description);
    assert.deepEqual(validateEvidenceFileText("ảnh hoá đơn", ""), {});
    assert.ok(validateEvidenceFileText("ok", "t".repeat(201)).title);
  });
});

describe("storedFileOf / downloadName", () => {
  it("only rows with storedFile count as a file; the name comes from payload.fileName, never the storage key", () => {
    assert.equal(storedFileOf({ description: "d", sha256: "a".repeat(64) }), null);
    assert.equal(storedFileOf(null), null);
    assert.deepEqual(storedFileOf({ fileName: "hoa-don.pdf", storedFile: { sha256: "x", mime: "application/pdf" } }), { fileName: "hoa-don.pdf" });
    assert.deepEqual(storedFileOf({ storedFile: { sha256: "x" } }), { fileName: null });
  });
  it("download name is cleaned, with a neutral fallback", () => {
    assert.equal(downloadName("a/b:c.pdf", "12345678-aaaa"), "a_b_c.pdf");
    assert.equal(downloadName(null, "12345678-aaaa"), "bang-chung-12345678");
  });
});

function fakeClient(reply: (cfg: Parameters<DisputeHttpClient["request"]>[0]) => unknown) {
  const calls: Array<Parameters<DisputeHttpClient["request"]>[0]> = [];
  const client: DisputeHttpClient = {
    async request(cfg) {
      calls.push(cfg);
      return { data: reply(cfg) as never, status: 200 };
    },
  };
  return { client, calls };
}

describe("uploadEvidenceFile / downloadEvidenceFile wire shape", () => {
  it("upload: multipart to /dispute-cases/:id/evidence-files with the key and exactly file + description (+ title)", async () => {
    const { client, calls } = fakeClient(() => ({ sha256: "s" }));
    const api = createDisputeCaseApi(client);
    await api.uploadEvidenceFile("case-1", { file: new Blob(["x"], { type: "image/png" }), fileName: "p.png", description: " ảnh ", title: "" }, "key-1234567890");
    const c = calls[0];
    assert.equal(c.method, "POST");
    assert.equal(c.url, "/dispute-cases/case-1/evidence-files");
    assert.equal(c.headers?.["Idempotency-Key"], "key-1234567890");
    assert.ok(c.data instanceof FormData);
    const fd = c.data as FormData;
    assert.deepEqual([...fd.keys()].sort(), ["description", "file"]);
    assert.equal(fd.get("description"), "ảnh");
    assert.equal((fd.get("file") as File).name, "p.png");
  });
  it("upload refuses a missing key before anything is sent", async () => {
    const { client, calls } = fakeClient(() => ({}));
    const api = createDisputeCaseApi(client);
    await assert.rejects(api.uploadEvidenceFile("c", { file: new Blob(["x"]), fileName: "a.png", description: "d" }, ""));
    assert.equal(calls.length, 0);
  });
  it("download: party and admin paths, as a Blob", async () => {
    const { client, calls } = fakeClient(() => new Blob(["bytes"]));
    const api = createDisputeCaseApi(client);
    await api.downloadEvidenceFile("c1", "e1", "party");
    await api.downloadEvidenceFile("c1", "e1", "admin");
    assert.equal(calls[0].url, "/dispute-cases/c1/evidence/e1/file");
    assert.equal(calls[1].url, "/admin/dispute-cases/c1/evidence/e1/file");
    assert.equal(calls[0].responseType, "blob");
  });
  it("download: a JSON error body that came back as a Blob is turned back into JSON, so the Vietnamese message shows", async () => {
    const client: DisputeHttpClient = {
      async request() {
        throw Object.assign(new Error("x"), { isAxiosError: true, response: { status: 409, data: new Blob([JSON.stringify({ error: "x", code: "EVIDENCE_FILE_INTEGRITY" })]) } });
      },
    };
    const api = createDisputeCaseApi(client);
    const err = await api.downloadEvidenceFile("c", "e", "admin").catch((e) => e);
    assert.equal(parseDisputeError(err).code, "EVIDENCE_FILE_INTEGRITY");
  });
});

describe("screens (CODE AUDIT)", () => {
  const party = readFileSync(new URL("../../disputes/DisputeCasePartyPage.tsx", import.meta.url), "utf8");
  const tab = readFileSync(new URL("../disputes/workspace/tabs/EvidenceTab.tsx", import.meta.url), "utf8");
  it("the upload form is drawn only when the server allows addEvidenceFile", () => {
    assert.match(party, /partyAllowed\(detail, "addEvidenceFile"\) && <PartyEvidenceFileForm/);
  });
  it("the admin download is drawn only with readEvidenceFile", () => {
    assert.match(tab, /isAllowed\(detail, "readEvidenceFile"\)/);
  });
});
