import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { profileService } from "../services/profile.service";
import { profileRepository } from "../repositories/profile.repository";
import { ptApplicationRepository } from "../repositories/pt_application.repository";

/**
 * Money-flow plan 5.5 — resolving the flagged TODO at profile.service.ts's canBecomePT
 * ("Replace with real checks — e.g. certificate uploaded, admin approval, ptApplicationStatus
 * === 'APPROVED'"). This was not just an unfinished stub: `canBecomePT` unconditionally
 * returned true, and PATCH /profile/me/become-pt is a live, authenticated route any CUSTOMER
 * can call directly — bypassing the whole PT-application review flow (submit → admin review →
 * approve) that pt_application.service.ts otherwise enforces before ever calling
 * profileRepository.setIsPT. A real privilege escalation, not a hypothetical.
 *
 * No real DB — profileRepository/ptApplicationRepository/axios.patch are monkey-patched per
 * test, same pattern used throughout this session's other service-level tests.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("becomePT is rejected 403-shaped when the caller has no PT application at all", async () => {
  const restoreFind = patch(ptApplicationRepository, "findByUserId", async () => null);
  const restoreSetIsPT = patch(profileRepository, "setIsPT", async () => {
    throw new Error("must not be called");
  });

  try {
    await assert.rejects(
      () => profileService.becomePT("user-1", "CUSTOMER"),
      /not allowed/i,
    );
  } finally {
    restoreFind();
    restoreSetIsPT();
  }
});

test("becomePT is rejected when the application exists but is not yet APPROVED (e.g. UNDER_REVIEW)", async () => {
  const restoreFind = patch(ptApplicationRepository, "findByUserId", async () => ({
    id: "app-1",
    status: "UNDER_REVIEW",
  }));
  const setIsPTCalls: unknown[] = [];
  const restoreSetIsPT = patch(profileRepository, "setIsPT", async (...args: unknown[]) => {
    setIsPTCalls.push(args);
    return {};
  });

  try {
    await assert.rejects(
      () => profileService.becomePT("user-2", "CUSTOMER"),
      /not allowed/i,
    );
    assert.equal(setIsPTCalls.length, 0, "a non-approved application must never flip isPT");
  } finally {
    restoreFind();
    restoreSetIsPT();
  }
});

test("becomePT succeeds once the caller's PT application is genuinely APPROVED", async () => {
  const restoreFind = patch(ptApplicationRepository, "findByUserId", async () => ({
    id: "app-3",
    status: "APPROVED",
  }));
  const setIsPTCalls: unknown[] = [];
  const restoreSetIsPT = patch(profileRepository, "setIsPT", async (userId: string, isPT: boolean) => {
    setIsPTCalls.push([userId, isPT]);
    return { userId, isPT };
  });
  const restorePatch = patch(axios, "patch", async () => ({ data: {} }));

  try {
    const result = await profileService.becomePT("user-3", "CUSTOMER");
    assert.ok(result.profile);
    assert.deepEqual(setIsPTCalls, [["user-3", true]]);
  } finally {
    restoreFind();
    restoreSetIsPT();
    restorePatch();
  }
});

test("becomePT still rejects a non-CUSTOMER/ADMIN role before ever checking the application status", async () => {
  const findCalls: unknown[] = [];
  const restoreFind = patch(ptApplicationRepository, "findByUserId", async (userId: unknown) => {
    findCalls.push(userId);
    return { status: "APPROVED" };
  });

  try {
    await assert.rejects(() => profileService.becomePT("user-4", "PT"), /already a PT/i);
    assert.equal(findCalls.length, 0, "the role guard must short-circuit before the application lookup");
  } finally {
    restoreFind();
  }
});
