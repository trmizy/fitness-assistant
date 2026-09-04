/**
 * Regression test for the P1 inconsistency found and fixed in this pass:
 * REST (POST /conversations/:id/messages) validated message content with
 * `sendMessageSchema` (min 1, max 5000 chars), but the WebSocket
 * `chat:send_message` handler only checked `!content?.trim()` — no length
 * cap at all. A message could bypass the REST length limit entirely just by
 * sending it over the socket instead of the REST endpoint.
 *
 * The fix makes the socket handler validate against the exact same
 * `sendMessageSchema` Zod schema the REST controller already uses — this
 * test locks down that shared schema's behavior directly (both handlers now
 * call the same `.safeParse`, so testing the schema covers both paths).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sendMessageSchema } from "../models/chat.models";

test("sendMessageSchema: rejects empty content", () => {
  const result = sendMessageSchema.safeParse({ content: "" });
  assert.equal(result.success, false);
});

test("sendMessageSchema: accepts normal-length content", () => {
  const result = sendMessageSchema.safeParse({ content: "Hello there" });
  assert.equal(result.success, true);
});

test("sendMessageSchema: accepts content at exactly the 5000-char boundary", () => {
  const result = sendMessageSchema.safeParse({ content: "a".repeat(5000) });
  assert.equal(result.success, true);
});

test("SECURITY: sendMessageSchema rejects content over 5000 chars — the exact bypass this fixed for the socket path", () => {
  const result = sendMessageSchema.safeParse({ content: "a".repeat(5001) });
  assert.equal(result.success, false);
});

test("SECURITY: an extremely large payload (1MB) is rejected, not just 'over by one'", () => {
  const result = sendMessageSchema.safeParse({ content: "a".repeat(1_000_000) });
  assert.equal(result.success, false);
});
