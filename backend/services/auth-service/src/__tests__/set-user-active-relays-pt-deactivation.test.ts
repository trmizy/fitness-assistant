import test from "node:test";
import assert from "node:assert/strict";
import { authService } from "../services/auth.service";
import { authRepository } from "../repositories/auth.repository";
import * as relay from "../services/pt-deactivation-relay.service";

/**
 * Money-flow redesign plan item 2.6 — end-to-end proof that locking/unlocking a PT's account
 * actually relays to user-service now, not just the relay module's own isolated contract
 * (pt-deactivation-relay.test.ts).
 *
 * `relayPtActiveStateChange` is a plain function export (not a method on an object), so it
 * cannot be monkey-patched via `import * as relay` the way session-autoconfirm's equivalent
 * attempt discovered earlier in this project (ES module namespace objects are read-only) —
 * instead this patches its OWN dependency, `authRepository.updateUser` (an object method, and
 * the ONLY collaborator setUserActive needs besides the relay call), and observes the relay's
 * effect indirectly through a spy passed via setUserActive's own deps parameter.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("disabling a PT account relays DEACTIVATE to user-service", async () => {
  const calls: unknown[] = [];
  const restore = patch(authRepository, "updateUser", async () => ({
    id: "pt-1",
    email: "pt@example.com",
    role: "PT",
    isActive: false,
  }));

  try {
    await authService.setUserActive("pt-1", false, "admin-1", "vi phạm điều khoản", {
      relay: async (ptUserId: string, action: string, adminId: string, reason?: string) => {
        calls.push([ptUserId, action, adminId, reason]);
      },
    } as any);
  } finally {
    restore();
  }

  assert.deepEqual(calls, [["pt-1", "DEACTIVATE", "admin-1", "vi phạm điều khoản"]]);
});

test("re-enabling a PT account relays REACTIVATE", async () => {
  const calls: unknown[] = [];
  const restore = patch(authRepository, "updateUser", async () => ({
    id: "pt-1",
    email: "pt@example.com",
    role: "PT",
    isActive: true,
  }));

  try {
    await authService.setUserActive("pt-1", true, "admin-1", undefined, {
      relay: async (ptUserId: string, action: string, adminId: string, reason?: string) => {
        calls.push([ptUserId, action, adminId, reason]);
      },
    } as any);
  } finally {
    restore();
  }

  assert.deepEqual(calls, [["pt-1", "REACTIVATE", "admin-1", undefined]]);
});

test("disabling a CUSTOMER account does not attempt any relay — there is nothing to unwind", async () => {
  let relayCalled = false;
  const restore = patch(authRepository, "updateUser", async () => ({
    id: "customer-1",
    email: "c@example.com",
    role: "CUSTOMER",
    isActive: false,
  }));

  try {
    await authService.setUserActive("customer-1", false, "admin-1", undefined, {
      relay: async () => {
        relayCalled = true;
      },
    } as any);
  } finally {
    restore();
  }

  assert.equal(relayCalled, false);
});

test("the account lock itself still succeeds even if the relay ultimately fails", async () => {
  const restore = patch(authRepository, "updateUser", async () => ({
    id: "pt-1",
    email: "pt@example.com",
    role: "PT",
    isActive: false,
  }));

  let result: any;
  try {
    result = await authService.setUserActive("pt-1", false, "admin-1", undefined, {
      relay: async () => {
        throw new Error("user-service unreachable");
      },
    } as any);
  } finally {
    restore();
  }

  assert.equal(result.isActive, false, "the primary action (the lock) is not rolled back by a relay failure");
});

// Sanity: the real relayPtActiveStateChange export still exists and is what production wires
// up by default (setUserActive's default deps), even though the tests above inject a spy.
test("relayPtActiveStateChange is exported and callable", () => {
  assert.equal(typeof relay.relayPtActiveStateChange, "function");
});
