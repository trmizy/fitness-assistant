/**
 * NE-02 — the register toast shows the sentence the server sent, whatever shape it used.
 *
 * Chạy: npx tsx --test src/lib/__tests__/serverMessage.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { serverMessage } from "../serverMessage";

const res = (data: unknown) => ({ response: { data } });

describe("serverMessage", () => {
  it("reads the string shapes the services use", () => {
    assert.equal(serverMessage(res({ error: "Mã xác nhận vừa được gửi. Vui lòng đợi 40 giây." })), "Mã xác nhận vừa được gửi. Vui lòng đợi 40 giây.");
    assert.equal(serverMessage(res({ error: { code: "X", message: "Lỗi từ gateway" } })), "Lỗi từ gateway");
    assert.equal(serverMessage(res({ message: "Lỗi phẳng" })), "Lỗi phẳng");
  });

  it("returns an empty string (caller keeps its own fallback) when there is nothing usable", () => {
    assert.equal(serverMessage(res({ error: { code: "X" } })), "");
    assert.equal(serverMessage(res({ error: "  " })), "");
    assert.equal(serverMessage(new Error("Network Error")), "");
    assert.equal(serverMessage(undefined), "");
  });
});
