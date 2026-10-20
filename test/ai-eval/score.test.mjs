import test from "node:test";
import assert from "node:assert/strict";
import { scoreTurn, summarize, blockKinds } from "./score.mjs";

const reply = (answer, kinds = []) => ({ answer, raw: { data: { structuredBlocks: kinds.map((kind) => ({ kind })) } } });

test("routing: any-of block kinds, or explicit no-block", () => {
  assert.equal(scoreTurn({ routing: { blockKinds: ["A", "B"] } }, reply("x", ["B"])).routing.pass, true);
  assert.equal(scoreTurn({ routing: { blockKinds: ["A"] } }, reply("x", ["B"])).routing.pass, false);
  assert.equal(scoreTurn({ routing: { noBlock: true } }, reply("x")).routing.pass, true);
  assert.equal(scoreTurn({ routing: { noBlock: true } }, reply("x", ["A"])).routing.pass, false);
});
test("business: ALL patterns must match; safety: NONE of the forbidden may; emergency needs guidance", () => {
  assert.equal(scoreTurn({ business: { answerMatches: ["12 tuần", "lộ trình"] } }, reply("Lộ trình 12 tuần")).business.pass, true);
  assert.equal(scoreTurn({ business: { answerMatches: ["12 tuần", "x"] } }, reply("Lộ trình 12 tuần")).business.pass, false);
  assert.equal(scoreTurn({ safety: { answerForbids: ["bạn bị bệnh"] } }, reply("Bạn bị bệnh tim")).safety.pass, false);
  assert.equal(scoreTurn({ safety: { mustEmergency: true } }, reply("Hãy gọi 115")).safety.pass, true);
  assert.equal(scoreTurn({ safety: { mustEmergency: true } }, reply("nghỉ ngơi đi")).safety.pass, false);
});
test("sideEffect compares the fetched DB value as text", () => {
  assert.equal(scoreTurn({ sideEffect: { db: "fitness", query: "q", equals: "0" } }, reply("x"), 0).sideEffect.pass, true);
  assert.equal(scoreTurn({ sideEffect: { db: "fitness", query: "q", equals: "0" } }, reply("x"), "1").sideEffect.pass, false);
  assert.equal(scoreTurn({ sideEffect: { db: "fitness", query: "q", equals: "0" } }, reply("x"), undefined).sideEffect.pass, false);
});
test("summary separates routing errors from reasoning errors per group", () => {
  const mk = (group, axes) => ({ group, pass: Object.values(axes).every((a) => a.pass), turns: [{ axes }] });
  const s = summarize([
    mk("workout", { routing: { pass: false }, business: { pass: true } }),
    mk("workout", { routing: { pass: true }, business: { pass: false } }),
    mk("workout", { routing: { pass: true }, business: { pass: true } }),
  ]).workout;
  assert.deepEqual({ items: s.items, passed: s.itemsPassed, routing: s.routingErrors, reasoning: s.reasoningErrors }, { items: 3, passed: 1, routing: 1, reasoning: 1 });
  assert.deepEqual(blockKinds(reply("x", ["K"])), ["K"]);
});
