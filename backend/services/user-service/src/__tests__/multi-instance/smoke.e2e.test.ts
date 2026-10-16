import test from "node:test";
import assert from "node:assert/strict";
import { skip, startMi, type Mi } from "./mi.harness";

let M: Mi;
test.before(async () => {
  if (skip) return;
  M = await startMi({ instances: 3 });
});
test.after(async () => {
  if (M) await M.close();
});

test("smoke: 3 instances, pay + deliver across instances, invariant", { skip }, async () => {
  await M.resetAll();
  const pt = await M.makePt();
  const A = await M.paidContract(pt);
  await M.deliver(A, 2);
  assert.equal((await M.contractRow(A.id)).usedSessions, 2);
  await M.invariant("smoke");
  console.log("pids", M.instances.map((i) => i.pid()), "calls", M.instances.map((i) => i.proxy.calls.length));
});
