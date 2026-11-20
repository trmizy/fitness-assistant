/**
 * Concurrent-login notice: api.ts records WHY a session ended (another device signed in) before it emits
 * "session expired"; AppContext shows it once on the login screen. Runs with `tsx --test`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_NOTICE_STORAGE_KEY,
  SESSION_REPLACED_CODE,
  SESSION_REPLACED_NOTICE,
  consumePersistedSessionNotice,
  peekPersistedSessionNotice,
  setSessionNotice,
  takeSessionNotice,
} from "../sessionEvents";

// Tab-scoped storage stand-in (node has no sessionStorage).
const mem = new Map<string, string>();
(globalThis as any).sessionStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

describe("session-ended notice", () => {
  it("is empty until something records a reason", () => {
    assert.equal(takeSessionNotice(), null);
  });

  it("is handed out exactly once", () => {
    setSessionNotice(SESSION_REPLACED_NOTICE);
    assert.equal(takeSessionNotice(), SESSION_REPLACED_NOTICE);
    assert.equal(takeSessionNotice(), null);
  });

  it("uses the server's SESSION_REPLACED code and a clear Vietnamese message", () => {
    assert.equal(SESSION_REPLACED_CODE, "SESSION_REPLACED");
    assert.match(SESSION_REPLACED_NOTICE, /Tài khoản đã đăng nhập trên thiết bị khác/);
  });
});

describe("session-ended notice survives a full page load (R2-05)", () => {
  it("setSessionNotice persists the reason; the login screen reads it, then consume removes it", () => {
    mem.clear();
    takeSessionNotice();
    setSessionNotice(SESSION_REPLACED_NOTICE);
    assert.equal(peekPersistedSessionNotice(), SESSION_REPLACED_NOTICE);
    assert.equal(peekPersistedSessionNotice(), SESSION_REPLACED_NOTICE); // peek does not remove
    assert.equal(consumePersistedSessionNotice(), SESSION_REPLACED_NOTICE);
    assert.equal(peekPersistedSessionNotice(), null);
  });

  it("forgets a stale or corrupt entry", () => {
    mem.clear();
    mem.set(SESSION_NOTICE_STORAGE_KEY, JSON.stringify({ message: "cũ", at: Date.now() - 11 * 60_000 }));
    assert.equal(consumePersistedSessionNotice(), null);
    mem.set(SESSION_NOTICE_STORAGE_KEY, "{not json");
    assert.equal(consumePersistedSessionNotice(), null);
    assert.equal(mem.size, 0);
  });
});
