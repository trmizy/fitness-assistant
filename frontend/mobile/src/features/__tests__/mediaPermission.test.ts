import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acquireWithPermissionRetry } from "../call/mediaPermission";

const named = (name: string) => Object.assign(new Error(name), { name });
const noWait = { sleep: async () => undefined };

describe("acquireWithPermissionRetry", () => {
  it("returns the first result without retrying", async () => {
    let calls = 0;
    assert.equal(await acquireWithPermissionRetry(async () => (++calls, "stream"), noWait), "stream");
    assert.equal(calls, 1);
  });

  it("retries once after a permission-shaped failure (the grant landed late) and returns the stream", async () => {
    let calls = 0;
    const out = await acquireWithPermissionRetry(async () => {
      if (++calls === 1) throw named("NotAllowedError");
      return "stream";
    }, noWait);
    assert.equal(out, "stream");
    assert.equal(calls, 2);
  });

  it("a real denial fails the second time too and is thrown (no loop)", async () => {
    let calls = 0;
    await assert.rejects(
      () => acquireWithPermissionRetry(async () => { calls++; throw named("NotAllowedError"); }, noWait),
      /NotAllowedError/,
    );
    assert.equal(calls, 2);
  });

  it("other failures (no device, bad constraints) are not retried", async () => {
    let calls = 0;
    await assert.rejects(() => acquireWithPermissionRetry(async () => { calls++; throw named("NotFoundError"); }, noWait), /NotFoundError/);
    assert.equal(calls, 1);
  });
});
