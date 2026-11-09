/**
 * D1 - idempotency action core, error mapping, query keys.
 * Evidence label: TEST FIXTURE (pure functions, fake senders, fixtures from real error bodies; no server was called).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d1-idempotency-errors-keys.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIdempotentAction, newIdempotencyKey, stableStringify } from "../disputes/useIdempotentAction";
import {
  DISPUTE_ERROR_CODES,
  NETWORK_READ_MESSAGE,
  NETWORK_WRITE_MESSAGE,
  canOfferRetry,
  mustReloadFirst,
  parseDisputeError,
  parseDisputeErrorBody,
} from "../disputes/disputeCaseErrors";
import { DISPUTE_QUERY_OPTIONS, DISPUTE_QUERY_ROOT, disputeQueryKeys } from "../disputes/disputeQueryKeys";
import { errBodies, IDS } from "../disputes/__fixtures__/disputeCaseFixtures";

const dir = dirname(fileURLToPath(import.meta.url));
const KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

// ───────────────────────────────────────────────────────── idempotency ──
describe("D1 idempotency - key shape", () => {
  it("crypto.randomUUID keys match the server regex and are unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const k = newIdempotencyKey();
      assert.match(k, KEY_RE);
      seen.add(k);
    }
    assert.equal(seen.size, 200);
  });
  it("stableStringify ignores key order and undefined", () => {
    assert.equal(stableStringify({ a: 1, b: { d: 1, c: [1, undefined] } }), stableStringify({ b: { c: [1, undefined], d: 1 }, a: 1, z: undefined }));
    assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
  });
});

describe("D1 idempotency - one key per attempt", () => {
  const counter = () => {
    let n = 0;
    return () => `key-${++n}`;
  };

  it("the key is STABLE when the same body is retried after a failure", async () => {
    const a = createIdempotentAction<{ reason: string }, string>({ newKey: counter() });
    const used: string[] = [];
    const fail = async (key: string) => {
      used.push(key);
      throw new Error("timeout");
    };
    const r1 = await a.run({ reason: "x" }, fail);
    const r2 = await a.run({ reason: "x" }, fail);
    const r3 = await a.run({ reason: "x" }, fail);
    assert.equal(r1.status, "error");
    assert.deepEqual(used, ["key-1", "key-1", "key-1"]);
    assert.equal(r2.status === "error" && r2.key, "key-1");
    assert.equal(r3.status, "error");
  });

  it("the key is NEW after a success", async () => {
    const a = createIdempotentAction<{ reason: string }, string>({ newKey: counter() });
    const used: string[] = [];
    const ok = async (key: string) => {
      used.push(key);
      return "done";
    };
    const r1 = await a.run({ reason: "x" }, ok);
    assert.equal(r1.status, "ok");
    await a.run({ reason: "x" }, ok);
    assert.deepEqual(used, ["key-1", "key-2"]);
    assert.equal(a.peekKey({ reason: "x" }), null);
  });

  it("the key is NEW when the body changed, and when the form is reopened (reset)", async () => {
    const a = createIdempotentAction<{ reason: string }, string>({ newKey: counter() });
    const used: string[] = [];
    const fail = async (key: string) => {
      used.push(key);
      throw new Error("x");
    };
    await a.run({ reason: "one" }, fail);
    await a.run({ reason: "two" }, fail); // changed body
    await a.run({ reason: "two" }, fail); // same again -> same key
    a.reset(); // form reopened
    await a.run({ reason: "two" }, fail);
    assert.deepEqual(used, ["key-1", "key-2", "key-2", "key-3"]);
  });

  it("body key order does not count as a change", async () => {
    const a = createIdempotentAction<Record<string, unknown>, string>({ newKey: counter() });
    const used: string[] = [];
    const fail = async (key: string) => {
      used.push(key);
      throw new Error("x");
    };
    await a.run({ a: 1, b: 2 }, fail);
    await a.run({ b: 2, a: 1 }, fail);
    assert.deepEqual(used, ["key-1", "key-1"]);
  });

  it("double click sends ONE request (second run while in flight is a no-op)", async () => {
    const a = createIdempotentAction<{ n: number }, string>({ newKey: counter() });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = async () => {
      calls += 1;
      await gate;
      return "ok";
    };
    const p1 = a.run({ n: 1 }, send);
    assert.equal(a.pending, true);
    const p2 = await a.run({ n: 1 }, send);
    const p3 = await a.run({ n: 1 }, send);
    assert.equal(p2.status, "busy");
    assert.equal(p3.status, "busy");
    release();
    const r1 = await p1;
    assert.equal(r1.status, "ok");
    assert.equal(calls, 1);
    assert.equal(a.pending, false);
  });

  it("reset while a request is in flight does not drop its key", async () => {
    const a = createIdempotentAction<{ n: number }, string>({ newKey: counter() });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = a.run({ n: 1 }, async () => {
      await gate;
      throw new Error("lost");
    });
    a.reset();
    release();
    const r = await p;
    assert.equal(r.status === "error" && r.key, "key-1");
    assert.equal(a.peekKey({ n: 1 }), "key-1");
  });

  it("does not retry by itself and never throws", async () => {
    const a = createIdempotentAction<{ n: number }, string>({ newKey: counter() });
    let calls = 0;
    const r = await a.run({ n: 1 }, async () => {
      calls += 1;
      throw new Error("boom");
    });
    assert.equal(r.status, "error");
    assert.equal(calls, 1);
  });

  it("pending flag is reported through the callback", async () => {
    const seen: boolean[] = [];
    const a = createIdempotentAction<number, string>({ newKey: counter(), onPendingChange: (p) => seen.push(p) });
    await a.run(1, async () => "ok");
    assert.deepEqual(seen, [true, false]);
  });

  it("a malformed key from a custom minter is refused before sending", async () => {
    const a = createIdempotentAction<number, string>({ newKey: () => "bad key with spaces" });
    let calls = 0;
    const r = await a.run(1, async () => {
      calls += 1;
      return "x";
    });
    assert.equal(r.status, "error");
    assert.equal(calls, 0);
  });
});

// ─────────────────────────────────────────────────────────── errors ──
const body = (status: number, b: unknown, action: "read" | "write" = "write") => parseDisputeErrorBody(status, b, { action });
const axiosErr = (status: number, data: unknown) => ({ response: { status, data } });

describe("D1 errors - kinds", () => {
  it("auth: dispute 401, gateway UNAUTHORIZED, bare 401 without code", () => {
    assert.equal(body(401, { error: "Cần đăng nhập", code: "UNAUTHENTICATED" }).kind, "auth");
    assert.equal(parseDisputeError(axiosErr(401, errBodies.gatewayUnauthorized)).kind, "auth");
    const bare = parseDisputeError(axiosErr(401, errBodies.noTokenNoCode));
    assert.equal(bare.kind, "auth");
    assert.ok(!/token/i.test(bare.message), "English server text is not shown");
  });
  it("forbidden: ADMIN_ONLY, SELF_APPROVAL_FORBIDDEN, CONFLICT_OF_INTEREST, NOT_ASSIGNED_INVESTIGATOR, gateway FORBIDDEN", () => {
    for (const code of ["ADMIN_ONLY", "SELF_APPROVAL_FORBIDDEN", "CONFLICT_OF_INTEREST", "NOT_ASSIGNED_INVESTIGATOR"]) assert.equal(body(403, { error: "x", code }).kind, "forbidden", code);
    assert.equal(parseDisputeError(axiosErr(403, errBodies.gatewayForbidden)).kind, "forbidden");
    assert.equal(parseDisputeError(axiosErr(403, { error: "Permission denied" })).kind, "forbidden");
  });
  it("notFound: CASE_NOT_FOUND and friends", () => {
    for (const code of ["CASE_NOT_FOUND", "SESSION_NOT_FOUND", "CLAIM_NOT_FOUND", "EVIDENCE_NOT_FOUND", "POLICY_REVIEW_NOT_FOUND"]) assert.equal(body(404, { error: "x", code }).kind, "notFound", code);
  });
  it("conflictReload: CASE_VERSION_CONFLICT -> reload, no blind retry", () => {
    const v = body(409, errBodies.versionConflict);
    assert.equal(v.kind, "conflictReload");
    assert.equal(v.code, "CASE_VERSION_CONFLICT");
    assert.match(v.message, /tải lại/);
    assert.equal(mustReloadFirst(v), true);
    assert.equal(canOfferRetry(v), false);
    assert.equal(v.outcomeUnknown, false);
  });
  it("blocked: state refusal names the current step in words, policy refusals have proper text", () => {
    const s = body(409, errBodies.stateNotAllowed);
    assert.equal(s.kind, "blocked");
    assert.match(s.message, /Đang đánh giá/);
    assert.ok(!s.message.includes("ASSESSING"));
    for (const [code, re] of [
      ["POLICY_ELIGIBILITY_UNVERIFIED", /chưa có kết luận áp dụng chính sách/],
      ["POLICY_EXCEPTION_APPLIES", /ngoại lệ lịch sử/],
      ["CANCELLED_BLOCKED_BY_D77", /khoản đền đến muộn nên không huỷ được/],
      ["CONTRACT_ENDING", /đang kết thúc/],
    ] as const) {
      const v = body(409, { error: "English or code only", code });
      assert.equal(v.kind, "blocked", code);
      assert.match(v.message, re, code);
      assert.ok(!v.message.includes(code) && !/\bD77\b/.test(v.message));
    }
  });
  it("blocked: share refusal and exec-blocked read details.reason into Vietnamese", () => {
    assert.match(body(409, errBodies.shareRefused).message, /chính một bên nộp/);
    assert.match(body(409, errBodies.execBlocked).message, /đang kết thúc/);
    assert.ok(!body(409, { error: "x", code: "EXEC_BLOCKED", details: { reason: "NEW_REASON" } }).message.includes("NEW_REASON"));
  });
  it("validation: Zod body keeps the fields", () => {
    const v = body(400, errBodies.zod);
    assert.equal(v.kind, "validation");
    assert.deepEqual(v.fields, [{ path: "reason", message: "Required" }]);
  });
  it("unavailable: 503 PAYMENT_UNAVAILABLE / LEDGER_UNAVAILABLE say it could not be verified, never success, nothing written", () => {
    for (const code of ["PAYMENT_UNAVAILABLE", "LEDGER_UNAVAILABLE"]) {
      const v = body(503, { error: "x", code });
      assert.equal(v.kind, "unavailable");
      assert.match(v.message, /chưa xác minh được/);
      assert.match(v.message, /Chưa có gì được ghi/);
      assert.ok(!/thành công|đã lưu|đã ghi nhận/i.test(v.message));
      assert.equal(v.outcomeUnknown, false, "a 503 refusal wrote nothing");
      assert.equal(canOfferRetry(v), true);
    }
  });
  it("EVIDENCE_CHANGED keeps changedIds / staleLive / needsRecollect and picks the right instruction", () => {
    const a = body(409, errBodies.evidenceChanged);
    assert.equal(a.kind, "blocked");
    assert.deepEqual(a.evidenceChange, { changedIds: [IDS.ev3], staleLive: [], needsRecollect: false });
    assert.deepEqual(a.details, errBodies.evidenceChanged.details);
    assert.match(a.message, /xác nhận thay đổi/);
    const b = body(409, errBodies.evidenceChangedStale);
    assert.equal(b.evidenceChange?.needsRecollect, true);
    assert.deepEqual(b.evidenceChange?.staleLive, ["gym-service.pt-check-ins:GYM_PT_CHECK_INS"]);
    assert.match(b.message, /thu lại/);
    // staleLive alone implies a recollect even if the flag were missing
    const c = body(409, { error: "x", code: "EVIDENCE_CHANGED", details: { changedIds: [], staleLive: ["s"] } });
    assert.equal(c.evidenceChange?.needsRecollect, true);
  });
  it("unknown code: the server's Vietnamese text; English text is replaced by a Vietnamese sentence", () => {
    const vi = body(409, errBodies.unknownCodeVi);
    assert.equal(vi.message, "Một lý do rất mới của máy chủ");
    assert.equal(vi.kind, "blocked");
    const en = body(409, errBodies.unknownCodeEn);
    assert.ok(!/odd/.test(en.message) && /[à-ỹ]/i.test(en.message));
    assert.ok(!en.message.includes("SOMETHING_NEW_FROM_SERVER"));
  });
  it("INTERNAL_ERROR on a write: unknown outcome, reload first", () => {
    const v = body(500, errBodies.internal);
    assert.equal(v.kind, "unknown");
    assert.equal(v.outcomeUnknown, true);
    assert.equal(mustReloadFirst(v), true);
    assert.match(v.message, /Chưa rõ thao tác đã được ghi hay chưa/);
    assert.equal(body(500, errBodies.internal, "read").outcomeUnknown, false);
  });
});

describe("D1 errors - network", () => {
  it("a network failure on a WRITE says the outcome is unknown and to reload first", () => {
    const v = parseDisputeError(new Error("Network Error"), { action: "write" });
    assert.equal(v.kind, "network");
    assert.equal(v.outcomeUnknown, true);
    assert.equal(v.message, NETWORK_WRITE_MESSAGE);
    assert.match(v.message, /Chưa biết thao tác đã được ghi hay chưa/);
    assert.match(v.message, /tải lại hồ sơ/);
    assert.equal(mustReloadFirst(v), true);
    assert.equal(canOfferRetry(v), false);
  });
  it("a network failure on a READ is plain, no 'unknown outcome'", () => {
    const v = parseDisputeError({ code: "ECONNABORTED" }, { action: "read" });
    assert.equal(v.kind, "network");
    assert.equal(v.outcomeUnknown, false);
    assert.equal(v.message, NETWORK_READ_MESSAGE);
  });
  it("garbage input never throws and never shows [object Object]", () => {
    for (const x of [undefined, null, "boom", 42, {}, { response: {} }, { response: { status: 418, data: "<html>" } }]) {
      const v = parseDisputeError(x, { action: "write" });
      assert.ok(v.message.length > 5 && !/object Object|undefined|null/.test(v.message));
    }
  });
});

describe("D1 errors - coverage of the documented codes", () => {
  const NEEDED = [
    "UNAUTHENTICATED", "ADMIN_ONLY", "NOT_ASSIGNED_INVESTIGATOR", "SELF_APPROVAL_FORBIDDEN", "CONFLICT_OF_INTEREST", "CASE_NOT_FOUND", "CASE_VERSION_CONFLICT",
    "CASE_STATE_NOT_ALLOWED", "IDEMPOTENCY_KEY_REUSED", "CLASSIFICATION_REQUIRED", "ASSESSMENT_REQUIRED", "EVIDENCE_CHANGED", "PAYMENT_UNAVAILABLE",
    "DESIGN_REQUIRED", "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED", "SESSION_NOT_DISPUTED", "CASE_DECISION_PENDING_EXECUTION", "POLICY_ELIGIBILITY_UNVERIFIED",
    "POLICY_EXCEPTION_APPLIES", "CANCELLED_BLOCKED_BY_D77", "D77_COMBINATION_UNRESOLVED", "CASE_REQUIRED", "EXECUTION_DISABLED", "EXEC_BLOCKED", "NEEDS_HUMAN",
    "EXECUTION_IN_PROGRESS", "FEATURE_DISABLED", "LATE_OPEN_RECONCILIATION_DISABLED", "LEDGER_UNAVAILABLE", "INVALID_INPUT", "INVALID_IDEMPOTENCY_KEY",
    "CONTRACT_ENDING", "FINDING_REQUIRED", "PROPOSAL_REQUIRED", "NO_PROPOSAL_FOR_FINDING", "ALREADY_CLASSIFIED", "REASON_REQUIRED", "SUPPLEMENT_REASON_REQUIRED",
    "EVIDENCE_LISTED_TWICE", "EVIDENCE_NOT_IN_CASE", "SUPERSEDES_INVALID", "POLICY_REVIEW_NOT_FOUND", "POLICY_REVIEW_ALREADY_APPROVED", "EVIDENCE_FILE_INTEGRITY",
    "STATEMENT_VERSION_CONFLICT", "INTERNAL_ERROR",
  ];
  it("every code of handoff section 6 and contract section A has a Vietnamese entry", () => {
    for (const code of NEEDED) assert.ok(DISPUTE_ERROR_CODES[code], `missing ${code}`);
  });
  it("no message is English, empty, or carries a raw code / internal tag", () => {
    for (const [code, entry] of Object.entries(DISPUTE_ERROR_CODES)) {
      const m = typeof entry.message === "function" ? entry.message(null) : entry.message;
      assert.ok(m.length > 8, code);
      assert.ok(/[à-ỹ]/i.test(m) || /Chưa/.test(m), `not Vietnamese: ${code}`);
      assert.ok(!/\b[A-Z]{3,}_[A-Z_]{2,}\b/.test(m), `raw enum in message of ${code}: ${m}`);
      assert.ok(!/\bD77\b|\bB-1\b|\bFH-\d|\bI6\b/.test(m), code);
    }
  });
  it("the AdminDisputes ruling error goes through the new mapping", () => {
    const v = parseDisputeError(axiosErr(409, { error: "x", code: "POLICY_ELIGIBILITY_UNVERIFIED" }), { action: "write" });
    assert.match(v.message, /Chưa phán quyết được/);
  });
});

// ─────────────────────────────────────────────────────── query keys ──
describe("D1 query keys", () => {
  it("every key starts with ['dispute-case', userId]", () => {
    const k = disputeQueryKeys("u1");
    const all = [k.all, k.list(), k.list({ status: "ASSESSING", limit: 10, offset: 20 }), k.detail("c1"), k.disputedSessions(), k.partyList(), k.partyDetail("c1")];
    for (const key of all) {
      assert.equal(key[0], DISPUTE_QUERY_ROOT);
      assert.equal(key[1], "u1");
    }
  });
  it("keys differ per user for the same query", () => {
    const a = disputeQueryKeys("admin-1");
    const b = disputeQueryKeys("admin-2");
    assert.notDeepEqual(a.list(), b.list());
    assert.notDeepEqual(a.detail("c1"), b.detail("c1"));
    assert.notDeepEqual(a.partyList(), b.partyList());
    assert.notDeepEqual(a.disputedSessions(), b.disputedSessions());
    assert.deepEqual(a.detail("c1"), disputeQueryKeys("admin-1").detail("c1"));
  });
  it("different filters and cases give different keys", () => {
    const k = disputeQueryKeys("u1");
    assert.notDeepEqual(k.list({ status: "INTAKE" }), k.list({ status: "ASSESSING" }));
    assert.notDeepEqual(k.list({ offset: 0 }), k.list({ offset: 50 }));
    assert.notDeepEqual(k.detail("a"), k.detail("b"));
  });
  it("a key can not exist without an owner", () => {
    assert.throws(() => disputeQueryKeys(""));
  });
  it("no polling: the shared options switch off every automatic refetch and retry", () => {
    assert.equal(DISPUTE_QUERY_OPTIONS.refetchInterval, false);
    assert.equal(DISPUTE_QUERY_OPTIONS.refetchOnWindowFocus, false);
    assert.equal(DISPUTE_QUERY_OPTIONS.refetchOnReconnect, false);
    assert.equal(DISPUTE_QUERY_OPTIONS.retry, false);
    for (const f of ["disputeQueryKeys.ts", "disputeCaseApi.ts", "useIdempotentAction.ts"]) {
      const src = readFileSync(join(dir, "..", "disputes", f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.ok(!/refetchInterval:\s*[1-9]|setInterval|POLL/.test(src), f);
    }
  });
});
