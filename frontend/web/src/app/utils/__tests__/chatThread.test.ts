/**
 * Web chat thread rules (N09F-01/02/03/04): draft length check, message merging, partner name/role, send error text.
 * Run: npx tsx --test src/app/utils/__tests__/chatThread.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  checkChatDraft,
  chatPartnerInitial,
  chatPartnerName,
  chatRoleLabel,
  chatSendErrorText,
  mergeMessages,
} from "../chatThread";

describe("checkChatDraft (N09F-02)", () => {
  it("blank or whitespace-only drafts cannot be sent, and say nothing", () => {
    for (const blank of ["", "   ", "\n\t "]) {
      const r = checkChatDraft(blank);
      assert.equal(r.ok, false);
      assert.equal(r.error, null);
    }
  });

  it("a normal draft is sendable, trimmed, with no counter", () => {
    const r = checkChatDraft("  xin chào  ");
    assert.equal(r.ok, true);
    assert.equal(r.text, "xin chào");
    assert.equal(r.showCounter, false);
  });

  it("exactly 5000 characters is allowed and shows the counter", () => {
    const r = checkChatDraft("a".repeat(CHAT_MESSAGE_MAX_LENGTH));
    assert.equal(r.ok, true);
    assert.equal(r.showCounter, true);
  });

  it("5001 characters is blocked with a Vietnamese reason that names the limit", () => {
    const r = checkChatDraft("a".repeat(CHAT_MESSAGE_MAX_LENGTH + 1));
    assert.equal(r.ok, false);
    assert.equal(r.showCounter, true);
    assert.match(r.error ?? "", /quá dài/);
    assert.match(r.error ?? "", /5\.000/);
  });

  it("the limit is measured after trimming, like the server", () => {
    assert.equal(checkChatDraft("   " + "a".repeat(CHAT_MESSAGE_MAX_LENGTH) + "   ").ok, true);
  });
});

describe("mergeMessages (N09F-01/03)", () => {
  const m = (id: string, sec: number, content = id) => ({
    id,
    createdAt: new Date(Date.UTC(2026, 10, 9, 10, 0, sec)).toISOString(),
    content,
  });

  it("joins older + newest pages oldest-first without repeating a message", () => {
    const older = [m("a", 1), m("b", 2), m("c", 3)];
    const newest = [m("c", 3), m("d", 4), m("e", 5)];
    assert.deepEqual(mergeMessages(older, newest).map((x) => x.id), ["a", "b", "c", "d", "e"]);
  });

  it("a refetch after a reconnect adds the messages missed meanwhile and keeps the older page", () => {
    const older = [m("a", 1), m("b", 2)];
    const beforeDrop = [m("c", 3), m("d", 4)];
    const afterReconnect = [m("c", 3), m("d", 4), m("e", 5), m("f", 6)];
    assert.deepEqual(mergeMessages(older, beforeDrop).map((x) => x.id), ["a", "b", "c", "d"]);
    assert.deepEqual(mergeMessages(older, afterReconnect).map((x) => x.id), ["a", "b", "c", "d", "e", "f"]);
  });

  it("copes with missing lists", () => {
    assert.deepEqual(mergeMessages(undefined, [m("a", 1)]).map((x) => x.id), ["a"]);
    assert.deepEqual(mergeMessages(), []);
  });
});

describe("chat partner name and role (N09F-04)", () => {
  it("a gym owner with no name shows as 'Chủ phòng tập' with a matching initial, not 'U' / 'Học viên'", () => {
    const owner = { firstName: "", lastName: "", role: "GYM_OWNER" };
    assert.equal(chatPartnerName(owner), "Chủ phòng tập");
    assert.equal(chatRoleLabel(owner.role), "Chủ phòng tập");
    assert.equal(chatPartnerInitial(owner), "C");
  });

  it("named users keep their name; roles get their own label", () => {
    assert.equal(chatPartnerName({ firstName: "Hà", lastName: "Vi", role: "PT" }), "Hà Vi");
    assert.equal(chatPartnerName({ firstName: " An ", lastName: null, role: "CUSTOMER" }), "An");
    assert.equal(chatPartnerInitial({ firstName: "đạt", lastName: "", role: "CUSTOMER" }), "Đ");
    assert.equal(chatRoleLabel("PT"), "Huấn luyện viên");
    assert.equal(chatRoleLabel("CUSTOMER"), "Học viên");
    assert.equal(chatRoleLabel("ADMIN"), "Quản trị viên");
  });

  it("an unknown role is not mislabelled as a student", () => {
    assert.equal(chatRoleLabel(undefined), "Thành viên");
    assert.equal(chatRoleLabel("SOMETHING_NEW"), "Thành viên");
    assert.equal(chatPartnerName(null), "Người dùng");
    assert.equal(chatPartnerInitial(undefined), "N");
  });
});

describe("chatSendErrorText (N09F-03/07)", () => {
  it("uses the server's Vietnamese sentence (locked recipient)", () => {
    const err = { response: { status: 403, data: { error: "Không thể gửi tin nhắn: tài khoản của người nhận hiện không hoạt động" } } };
    assert.match(chatSendErrorText(err), /không hoạt động/);
  });

  it("never shows an English server string; falls back on the status", () => {
    assert.match(chatSendErrorText({ response: { status: 400, data: { error: "Validation failed" } } }), /Chưa gửi được/);
    assert.match(chatSendErrorText({ response: { status: 401, data: {} } }), /đăng nhập/);
    assert.match(chatSendErrorText({ response: { status: 413, data: {} } }), /quá dài/);
    assert.match(chatSendErrorText({ response: { status: 503, data: {} } }), /Máy chủ/);
  });

  it("a network failure (no response) asks to check the connection and retry", () => {
    assert.match(chatSendErrorText(new Error("Network Error")), /Kiểm tra kết nối/);
  });
});
