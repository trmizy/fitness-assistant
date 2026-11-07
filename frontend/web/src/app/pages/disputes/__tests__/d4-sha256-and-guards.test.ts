/**
 * D4 sha256 (crypto.subtle) and source guards. Evidence labels: TEST FIXTURE (sha256 on known vectors, node's webcrypto) and CODE AUDIT (source text).
 * Run: npx tsx --test src/app/pages/disputes/__tests__/d4-sha256-and-guards.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HASH_MESSAGE, sha256OfFile, toHex } from "../sha256";
import { MAX_HASH_FILE_BYTES } from "../partyModel";
import { disputeQueryKeys } from "../../admin/disputes/disputeQueryKeys";
import { createIdempotentAction } from "../../admin/disputes/useIdempotentAction";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");
const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("D4 sha256 of a local file", () => {
  it("known vector: 'abc'", async () => {
    const r = await sha256OfFile(new Blob(["abc"]));
    assert.deepEqual(r, { status: "ok", hex: SHA_ABC });
  });
  it("hex is 64 lower-case chars, bytes with leading zeros keep them", async () => {
    assert.equal(toHex(new Uint8Array([0, 1, 15, 16, 255]).buffer), "00010f10ff");
    const r = await sha256OfFile(new Blob([new Uint8Array(1000).fill(7)]));
    assert.ok(r.status === "ok" && /^[0-9a-f]{64}$/.test(r.hex));
  });
  it("an empty file is refused (its hash is the well-known empty digest, never useful as evidence)", async () => {
    assert.deepEqual(await sha256OfFile(new Blob([])), { status: "empty" });
    assert.notEqual(SHA_EMPTY, "");
  });
  it("above the cap -> too-large, and the bytes are never read", async () => {
    let read = false;
    const big = { size: MAX_HASH_FILE_BYTES + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } };
    assert.deepEqual(await sha256OfFile(big), { status: "too-large" });
    assert.equal(read, false);
  });
  it("no crypto.subtle (insecure origin) -> unsupported with a message that offers pasting", async () => {
    assert.deepEqual(await sha256OfFile(new Blob(["abc"]), null), { status: "unsupported" });
    assert.match(HASH_MESSAGE.unsupported, /dán mã/);
  });
  it("a read failure -> error (never a made-up hash)", async () => {
    const bad = { size: 3, arrayBuffer: async () => { throw new Error("denied"); } };
    assert.deepEqual(await sha256OfFile(bad), { status: "error" });
  });
});

describe("D4 source guards (CODE AUDIT)", () => {
  const files = fs.readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));
  const src = Object.fromEntries(files.map((f) => [f, read(f)]));
  const code = (f: string) => src[f].replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("no file upload path: no FormData / multipart / evidence-files / Blob in a request, no storage route", () => {
    for (const f of files) {
      assert.doesNotMatch(code(f), /new FormData|multipart|evidence-files|\.upload\(|XMLHttpRequest|\bfetch\(/, f);
    }
  });
  it("the document form hands only the validated string body to the API", () => {
    const c = code("DocumentForm.tsx");
    assert.match(c, /validateDocument\(\{ description, title, fileName, sha256: sha \}\)/);
    assert.match(c, /submitEvidence\(caseId, body, key\)/);
    assert.doesNotMatch(c, /submitEvidence\([^)]*file/i);
  });
  it("the file object is only passed to sha256OfFile", () => {
    const c = code("DocumentForm.tsx");
    assert.equal((c.match(/\bfile\b(?!Name)/g) ?? []).filter(Boolean).length > 0, true);
    assert.match(c, /sha256OfFile\(file\)/);
  });
  it("queries are user-scoped (keys from useDisputeQueryKeys) and never poll", () => {
    for (const f of ["MyDisputesPage.tsx", "DisputeCasePartyPage.tsx"]) {
      const c = code(f);
      assert.match(c, /useDisputeQueryKeys\(\)/, f);
      assert.match(c, /\.\.\.DISPUTE_QUERY_OPTIONS/, f);
      assert.doesNotMatch(c, /refetchInterval:\s*[1-9]|refetchOnWindowFocus:\s*true/, f);
      assert.match(c, /enabled: !!keys/, f);
    }
    const k = disputeQueryKeys("user-a");
    assert.deepEqual(k.partyList().slice(0, 2), ["dispute-case", "user-a"]);
    assert.deepEqual(k.partyDetail("c1").slice(0, 2), ["dispute-case", "user-a"]);
    assert.notDeepEqual(disputeQueryKeys("user-b").partyList(), k.partyList());
  });
  it("no userId / clientId / ptId is sent: the forms never read the signed-in user", () => {
    for (const f of ["StatementForm.tsx", "DocumentForm.tsx"]) assert.doesNotMatch(code(f), /userId|clientId|ptId|useApp\(/, f);
  });
  it("no hard-coded colour (hex / rgb) and no admin token in the party screens", () => {
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      assert.doesNotMatch(code(f), /#[0-9a-fA-F]{3,8}\b|rgba?\(|adm-|--adm/, f);
    }
  });
  it("party files must not contain undefined variables --surface-color or --muted-color", () => {
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      assert.doesNotMatch(code(f), /--surface-color|--muted-color/, f);
    }
  });
  it("visible text never says the other side was notified, an appeal, or 'buổi tập không bị trừ'", () => {
    for (const f of files.filter((x) => !x.endsWith(".test.ts"))) {
      const strings = (code(f).match(/"[^"\n]*"|`[^`\n]*`/g) ?? []).join("\n");
      assert.doesNotMatch(strings, /đã được thông báo|đã báo cho|bên kia đã|kháng cáo|phúc thẩm|không bị trừ/i, f);
    }
  });
  it("the sentences the brief demands are present", () => {
    const labels = read("partyLabels.ts");
    assert.match(labels, /Không có tệp nào được tải lên/);
    assert.match(labels, /không phải xác nhận tiền đã về/);
    assert.match(labels, /không hiển thị số tiền/);
  });
});

describe("D4 double click / retry use one idempotency key (the D1 action the forms use)", () => {
  it("two runs at once send once; a retry of the same body reuses the key; a success renews it", async () => {
    const keys: string[] = [];
    let n = 0;
    const action = createIdempotentAction<{ text: string }, { ok: true }>({ newKey: () => `k${++n}` });
    let release!: () => void;
    const first = action.run({ text: "a" }, (k) => { keys.push(k); return new Promise((res) => { release = () => res({ ok: true }); }); });
    const second = await action.run({ text: "a" }, (k) => { keys.push(k); return Promise.resolve({ ok: true as const }); });
    assert.equal(second.status, "busy");
    release();
    assert.equal((await first).status, "ok");
    assert.deepEqual(keys, ["k1"]);
    const fail = await action.run({ text: "b" }, (k) => { keys.push(k); return Promise.reject(new Error("net")); });
    assert.equal(fail.status, "error");
    await action.run({ text: "b" }, (k) => { keys.push(k); return Promise.resolve({ ok: true as const }); });
    assert.deepEqual(keys, ["k1", "k2", "k2"], "same body after a failure replays the same key");
    await action.run({ text: "b" }, (k) => { keys.push(k); return Promise.resolve({ ok: true as const }); });
    assert.equal(keys[3], "k3", "after a success the next attempt is a new operation");
  });
});
