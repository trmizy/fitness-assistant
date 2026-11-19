/**
 * CALL-01: the client side of the socket token renewal. Runs with `tsx --test`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { answerTokenRequest } from "../socketTokenAuth";

const jwt = (expInS: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInS })).toString("base64url")}.s`;

describe("answerTokenRequest", () => {
  it("refreshes first, then answers with the live token", async () => {
    const order: string[] = [];
    let current = jwt(-10);
    let answer: unknown;
    await answerTokenRequest((a: unknown) => (answer = a), {
      ensureFresh: async () => {
        order.push("refresh");
        current = jwt(900);
      },
      readToken: () => {
        order.push("read");
        return current;
      },
    });
    assert.deepEqual(order, ["refresh", "read"]);
    assert.deepEqual(answer, { token: current });
  });

  it("never answers with an expired / about-to-expire token (the server would treat it as a refusal)", async () => {
    let answer: unknown;
    await answerTokenRequest((a: unknown) => (answer = a), { ensureFresh: async () => true, readToken: () => jwt(20) });
    assert.deepEqual(answer, {});
  });

  it("answers empty when there is no token or the refresh throws; ignores a missing ack", async () => {
    let answer: unknown;
    await answerTokenRequest((a: unknown) => (answer = a), { ensureFresh: async () => true, readToken: () => null });
    assert.deepEqual(answer, {});
    await answerTokenRequest((a: unknown) => (answer = a), {
      ensureFresh: async () => {
        throw new Error("offline");
      },
      readToken: () => jwt(900),
    });
    assert.deepEqual(answer, {});
    await answerTokenRequest(undefined, { ensureFresh: async () => true, readToken: () => jwt(900) });
  });
});
