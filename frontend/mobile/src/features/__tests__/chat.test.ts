/**
 * Phase 9 — SH-04/CL-21 chat helpers. Shapes are the real chat-service responses (checked 22/9).
 *
 * Runs with: npx tsx --test src/features/__tests__/chat.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canSend,
  dayDivider,
  MAX_MESSAGE_LENGTH,
  mergeMessage,
  normalizeConversations,
  normalizeMessage,
  normalizeMessages,
  peerName,
  peerRoleLabel,
  systemMessageText,
  threadTime,
} from "../chat/chat";

const conv = (id: string, at: string | null, extra: any = {}) => ({
  id,
  type: "DIRECT",
  otherUser: { id: "u", firstName: "Professional", lastName: "Trainer", role: "PT" },
  lastMessage: at ? { content: "hi", createdAt: at } : null,
  lastMessageAt: at,
  ...extra,
});

describe("chat", () => {
  it("reads bare arrays and envelopes, newest thread first", () => {
    const list = normalizeConversations([conv("a", "2026-08-01T00:00:00Z"), conv("b", "2026-09-01T00:00:00Z")]);
    assert.deepEqual(list.map((c) => c.id), ["b", "a"]);
    assert.equal(normalizeConversations({ data: [conv("x", null)] }).length, 1);
    assert.deepEqual(normalizeConversations(null), []);
  });

  it("messages: senderId accepted, oldest first", () => {
    const msgs = normalizeMessages([
      { id: "2", senderId: "u2", content: "b", createdAt: "2026-09-01T10:00:00Z", conversationId: "c" },
      { id: "1", authorId: "u1", content: "a", createdAt: "2026-09-01T09:00:00Z", conversationId: "c" },
    ]);
    assert.deepEqual(msgs.map((m) => m.id), ["1", "2"]);
    assert.equal(msgs[1].authorId, "u2");
  });

  it("a pushed message is merged exactly once (gateway sends it twice and echoes to sender)", () => {
    const m = normalizeMessage({ id: "9", authorId: "me", content: "x", createdAt: "2026-09-02T00:00:00Z", conversationId: "c" });
    const once = mergeMessage([], m);
    assert.equal(mergeMessage(once, m).length, 1);
    assert.equal(mergeMessage(undefined, m).length, 1);
  });

  it("names and roles in Vietnamese, never raw enums", () => {
    assert.equal(peerName(normalizeConversations([conv("a", null)])[0]), "Professional Trainer");
    assert.equal(peerName(normalizeConversations([conv("a", null, { otherUser: null })])[0]), "Người dùng");
    assert.equal(peerRoleLabel("PT"), "Huấn luyện viên");
    assert.equal(peerRoleLabel("CUSTOMER"), "Học viên");
  });

  it("thread time: clock today, 'Hôm qua', 'N ngày', then dd/mm", () => {
    const now = new Date(2026, 8, 22, 18, 0);
    assert.equal(threadTime(new Date(2026, 8, 22, 9, 5).toISOString(), now), "09:05");
    assert.equal(threadTime(new Date(2026, 8, 21, 23, 0).toISOString(), now), "Hôm qua");
    assert.equal(threadTime(new Date(2026, 8, 19, 8, 0).toISOString(), now), "3 ngày");
    assert.equal(threadTime(new Date(2026, 7, 1, 8, 0).toISOString(), now), "01/08");
    assert.equal(threadTime(null, now), "");
  });

  it("day dividers only when the date changes", () => {
    const now = new Date(2026, 8, 22, 18, 0);
    const a = normalizeMessage({ id: "1", authorId: "x", content: "", createdAt: new Date(2026, 8, 21, 9).toISOString(), conversationId: "c" });
    const b = normalizeMessage({ id: "2", authorId: "x", content: "", createdAt: new Date(2026, 8, 22, 9).toISOString(), conversationId: "c" });
    const c = normalizeMessage({ id: "3", authorId: "x", content: "", createdAt: new Date(2026, 8, 22, 10).toISOString(), conversationId: "c" });
    assert.equal(dayDivider(undefined, a, now), "Hôm qua");
    assert.equal(dayDivider(a, b, now), "Hôm nay");
    assert.equal(dayDivider(b, c, now), null);
  });

  it("send gate matches chat-service's 1..5000 chars", () => {
    assert.equal(canSend("  "), false);
    assert.equal(canSend("ok"), true);
    assert.equal(canSend("x".repeat(MAX_MESSAGE_LENGTH + 1)), false);
  });
});

describe("systemMessageText", () => {
  it("drops the server's 📞 prefix (the bubble has its own icon), leaves other text alone", () => {
    assert.equal(systemMessageText("📞 Cuộc gọi video nhỡ"), "Cuộc gọi video nhỡ");
    assert.equal(systemMessageText("📞 Video call ended (0:00)"), "Video call ended (0:00)");
    assert.equal(systemMessageText("Không có biểu tượng"), "Không có biểu tượng");
  });
});
