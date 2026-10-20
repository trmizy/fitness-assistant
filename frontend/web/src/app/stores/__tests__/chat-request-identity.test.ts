/**
 * R222-03 — durable chat request identity. Pure-logic node:test (this frontend's convention, no jsdom).
 * Run with: npx tsx --test src/app/stores/__tests__/chat-request-identity.test.ts
 *
 * Evidence labels: the rules are exercised directly (TEST FIXTURE); the wiring into pendingAiTasks.ts / api.ts /
 * AICoachPage.tsx is a CODE AUDIT by source inspection. REAL_BROWSER_NOT_VERIFIED: no browser run was possible.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
import {
  describeChatRequest,
  findRetryable,
  forUser,
  newChatRequestFields,
  recoverInterrupted,
  type ChatRequestRecord,
} from "../chat-request-identity";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const persist = (store: ChatRequestRecord[], userId: string, key: string, q: string): ChatRequestRecord => {
  const f = newChatRequestFields(userId, key, q, uuid);
  const rec: ChatRequestRecord = { ...f, kind: "chat-ask", status: "PROCESSING", createdAt: `2026-10-19T10:00:${String(n).padStart(2, "0")}Z` };
  store.unshift(rec);
  return rec;
};
const fail = (r: ChatRequestRecord, uncertain = true) => Object.assign(r, { status: "FAILED", uncertain });

describe("R222-03 chat request identity", () => {
  it("1. a normal send creates exactly one persisted id, equal to its task id, before anything is sent", () => {
    const store: ChatRequestRecord[] = [];
    const r = persist(store, "u1", "s1", "  tạo thực đơn  ");
    assert.equal(r.clientRequestId, r.id);
    assert.equal(r.question, "tạo thực đơn");
    assert.equal(store.length, 1);
  });

  it("2. an explicit retry reuses the SAME id and the STORED question (the payload cannot drift)", () => {
    const store: ChatRequestRecord[] = [];
    const r = persist(store, "u1", "s1", "tạo thực đơn");
    fail(r);
    const retry = findRetryable(store, "u1", "s1");
    assert.ok(retry);
    assert.equal(retry!.clientRequestId, r.clientRequestId);
    assert.equal(retry!.question, "tạo thực đơn", "a retry sends the original text, whatever the input box now says");
  });

  it("5. an intentional repeat of identical text is a NEW action with a NEW id (text equality is never the identity)", () => {
    const store: ChatRequestRecord[] = [];
    const a = persist(store, "u1", "s1", "tạo thực đơn");
    a.status = "COMPLETED";
    const b = persist(store, "u1", "s1", "tạo thực đơn");
    assert.notEqual(a.clientRequestId, b.clientRequestId);
    assert.equal(findRetryable(store, "u1", "s1"), null, "a completed request is not retryable");
  });

  it("6. refresh recovery: a send interrupted by a reload becomes UNCERTAIN, keeps its id, and is offered for retry — never replayed with a new id", () => {
    const store: ChatRequestRecord[] = [];
    const r = persist(store, "u1", "s1", "tạo thực đơn");
    const recovered = recoverInterrupted(store, "u1", new Set()); // no live request after reload
    assert.equal(recovered[0].status, "FAILED");
    assert.equal(recovered[0].uncertain, true);
    assert.equal(recovered[0].clientRequestId, r.clientRequestId);
    assert.equal(findRetryable(recovered, "u1", "s1")!.clientRequestId, r.clientRequestId);
    // a request that is genuinely still live in this page is left alone
    const live = recoverInterrupted(store, "u1", new Set([r.id]));
    assert.equal(live[0].status, "PROCESSING");
  });

  it("7. account switch: another user's pending id is invisible, not retryable and not recovered", () => {
    const store: ChatRequestRecord[] = [];
    const alice = persist(store, "alice", "s1", "tạo thực đơn");
    fail(alice);
    assert.deepEqual(forUser(store, "bob"), []);
    assert.equal(findRetryable(store, "bob", "s1"), null);
    assert.equal(findRetryable(store, undefined, "s1"), null);
    const untouched = recoverInterrupted(store, "bob", new Set());
    assert.equal(untouched[0].status, "FAILED");
    assert.equal(findRetryable(store, "alice", "s1")!.clientRequestId, alice.clientRequestId);
  });

  it("a retry is scoped to its own thread (same user, other session: not offered)", () => {
    const store: ChatRequestRecord[] = [];
    fail(persist(store, "u1", "s1", "q"));
    assert.equal(findRetryable(store, "u1", "other-thread"), null);
  });

  it("10. states are described truthfully: pending / completed / failed / uncertain, and only retryable when id + question exist", () => {
    const store: ChatRequestRecord[] = [];
    const r = persist(store, "u1", "s1", "q");
    assert.deepEqual(describeChatRequest(r), { state: "pending", label: "AI đang xử lý yêu cầu của bạn…", canRetry: false });
    fail(r, false);
    const failed = describeChatRequest(r);
    assert.equal(failed.state, "failed");
    assert.equal(failed.canRetry, true);
    r.uncertain = true;
    const uncertain = describeChatRequest(r);
    assert.equal(uncertain.state, "uncertain");
    assert.match(uncertain.label, /Chưa rõ/);
    assert.match(uncertain.label, /không bị tạo trùng/);
    assert.match(uncertain.label, /nhận lại đúng kết quả đó/, "promises replay only because the server now de-duplicates plain questions too");
    r.status = "COMPLETED";
    assert.equal(describeChatRequest(r).state, "completed");
    assert.equal(describeChatRequest({ id: "x", userId: "u1", kind: "chat-ask", status: "FAILED" }).canRetry, false, "no id/question => not retryable");
  });
});

describe("R222-03 wiring (CODE AUDIT of the real client)", () => {
  const root = path.join(here, "..", "..");
  const store = fs.readFileSync(path.join(root, "stores", "pendingAiTasks.ts"), "utf8");
  const api = fs.readFileSync(path.join(root, "services", "api.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "pages", "client", "AICoachPage.tsx"), "utf8");

  it("1/2. the store persists the id with the task BEFORE sending, and passes it to both transports", () => {
    assert.match(store, /clientRequestId,\n\s+question: question\.trim\(\),\n\s+sessionKey: key,/);
    assert.ok(store.indexOf("upsertTask(userId, {") < store.indexOf(".chat(question.trim(), outgoingSessionId, clientRequestId)"), "persisted before the first send");
    assert.match(store, /outgoingSessionId,\n\s+clientRequestId,\n\s+\);/);
  });

  it("2. retryQuestion reuses the stored task (same id, stored question) and is wired into the page", () => {
    assert.match(store, /findRetryable\(getUserTasks\(userId\), userId, key\)/);
    assert.match(store, /sendQuestion\("", onSessionAdopted, \{ retryOfTaskId: r\.id \}\)/);
    assert.match(page, /onClick=\{\(\) => retryQuestion\(handleSessionAdopted\)\}/);
    assert.match(page, /session\.status === "failed" && retryable/);
  });

  it("3/4. the automatic 401 resend and the stream share ONE id bound once per call", () => {
    assert.match(api, /chat: async \(message: string, sessionId\?: string, clientRequestId: string = newClientRequestId\(\)\)/);
    assert.match(api, /clientRequestId: string = newClientRequestId\(\),\n  \): \(\) => void/);
    const stream = api.slice(api.indexOf("chatStream("));
    assert.ok(stream.indexOf("clientRequestId, // same id") < stream.indexOf("await refreshOnce()"));
  });

  it("6/7. refresh recovery runs on mount and tasks are read per user", () => {
    assert.match(store, /useEffect\(\(\) => \{\n\s+if \(userId && key\) recoverInterruptedChats\(userId, key\);/);
    assert.match(store, /function getUserTasks\(userId\?: string\)/);
  });

  it("failures after the request left are marked uncertain (never silently downgraded or replayed)", () => {
    assert.match(store, /updateTaskState\("FAILED", errorText, \{ uncertain: true \}\)/);
  });
});
