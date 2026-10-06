import test from "node:test";
import assert from "node:assert/strict";
import { chatMessageFromRestResponse } from "../socket/chatRestRelay";

/**
 * Regression (6/10, real phone): a message sent over REST reached the database but never the
 * recipient's gateway socket, so it only showed after a refresh. The gateway now relays a
 * successful REST send to the conversation room; this pins which responses count as one.
 */
const CONV = "71445a1e-b3d6-4fd0-b8ea-23550ada2441";
const saved = {
  id: "f97c4ca8-3286-460f-aa03-d8ad9297cefe",
  conversationId: CONV,
  authorId: "37f754e5-cda2-4836-b3b7-ab3e46829594",
  content: "Xin chào",
  createdAt: "2026-10-06T04:55:00.000Z",
};

test("a successful POST to a conversation's messages is relayed with the saved message", () => {
  assert.deepEqual(chatMessageFromRestResponse("POST", `/chat/conversations/${CONV}/messages`, 201, saved), {
    id: saved.id,
    conversationId: CONV,
    authorId: saved.authorId,
    senderId: undefined,
    content: "Xin chào",
    createdAt: saved.createdAt,
  });
  assert.ok(chatMessageFromRestResponse("POST", `/chat/conversations/${CONV}/messages?x=1`, 200, saved));
});

test("reads, failures and other endpoints are not relayed", () => {
  assert.equal(chatMessageFromRestResponse("GET", `/chat/conversations/${CONV}/messages`, 200, saved), null);
  assert.equal(chatMessageFromRestResponse("POST", `/chat/conversations/${CONV}/messages`, 403, { error: "x" }), null);
  assert.equal(chatMessageFromRestResponse("POST", "/chat/conversations", 201, saved), null);
  assert.equal(chatMessageFromRestResponse("POST", `/chat/conversations/${CONV}/messages/read`, 200, saved), null);
});

test("a body that is not a saved message, or belongs to another conversation, is ignored", () => {
  assert.equal(chatMessageFromRestResponse("POST", `/chat/conversations/${CONV}/messages`, 200, { ok: true }), null);
  assert.equal(chatMessageFromRestResponse("POST", `/chat/conversations/${CONV}/messages`, 200, null), null);
  assert.equal(
    chatMessageFromRestResponse("POST", `/chat/conversations/${CONV}/messages`, 200, { ...saved, conversationId: "other" }),
    null,
  );
});
