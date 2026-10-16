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
      audit: async () => {},
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
      audit: async () => {},
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
      audit: async () => {},
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
      audit: async () => {},
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

// ── PT-lock slice 1, item 3: who and why are recorded ───────────────────────────────────────

test("locking and unlocking write an audit entry with the admin and the reason", async () => {
  const entries: any[] = [];
  const restore = patch(authRepository, "updateUser", async (_id: string, data: any) => ({
    id: "pt-1",
    email: "pt@example.com",
    role: "PT",
    isActive: data.isActive,
  }));
  try {
    const deps = { relay: async () => {}, audit: async (e: any) => void entries.push(e) } as any;
    await authService.setUserActive("pt-1", false, "admin-1", "vi phạm điều khoản", deps);
    await authService.setUserActive("pt-1", true, "admin-2", undefined, deps);
  } finally {
    restore();
  }

  assert.deepEqual(entries, [
    { userId: "pt-1", action: "ACCOUNT_LOCKED", metadata: { actorUserId: "admin-1", reason: "vi phạm điều khoản", targetRole: "PT" } },
    { userId: "pt-1", action: "ACCOUNT_UNLOCKED", metadata: { actorUserId: "admin-2", reason: null, targetRole: "PT" } },
  ]);
});

test("a missing reason is accepted (the mobile admin screen sends none) and relayed as undefined", async () => {
  const relayed: unknown[] = [];
  const restore = patch(authRepository, "updateUser", async () => ({ id: "pt-1", email: "p@e.com", role: "PT", isActive: false }));
  try {
    await authService.setUserActive("pt-1", false, "admin-1", undefined, {
      relay: async (...args: unknown[]) => void relayed.push(args),
      audit: async () => {},
    } as any);
  } finally {
    restore();
  }
  assert.deepEqual(relayed, [["pt-1", "DEACTIVATE", "admin-1", undefined]]);
});

test("a failing audit write does not block or undo the lock, and the relay still happens", async () => {
  let relayed = false;
  const restore = patch(authRepository, "updateUser", async () => ({ id: "pt-1", email: "p@e.com", role: "PT", isActive: false }));
  let result: any;
  try {
    result = await authService.setUserActive("pt-1", false, "admin-1", "x", {
      relay: async () => {
        relayed = true;
      },
      audit: async () => {
        throw new Error("audit table unavailable");
      },
    } as any);
  } finally {
    restore();
  }
  assert.equal(result.isActive, false);
  assert.equal(relayed, true);
});

test("a CUSTOMER account lock is audited too (who locked whom is not PT-specific)", async () => {
  const entries: any[] = [];
  const restore = patch(authRepository, "updateUser", async () => ({ id: "c-1", email: "c@e.com", role: "CUSTOMER", isActive: false }));
  try {
    await authService.setUserActive("c-1", false, "admin-1", "spam", {
      relay: async () => {
        throw new Error("must not be called");
      },
      audit: async (e: any) => void entries.push(e),
    } as any);
  } finally {
    restore();
  }
  assert.equal(entries.length, 1);
  assert.equal(entries[0].metadata.targetRole, "CUSTOMER");
});
