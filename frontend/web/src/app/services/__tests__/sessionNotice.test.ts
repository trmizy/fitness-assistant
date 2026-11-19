/**
 * Concurrent-login notice: api.ts records WHY a session ended (another device signed in) before it emits
 * "session expired"; AppContext shows it once on the login screen. Runs with `tsx --test`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SESSION_REPLACED_CODE, SESSION_REPLACED_NOTICE, setSessionNotice, takeSessionNotice } from "../sessionEvents";

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
