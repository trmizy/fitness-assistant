/**
 * GET /admin/partner-accounts/role-index: every STAFF partner role (MANAGER / RECEPTIONIST / ACCOUNTANT) with its user ids, in one answer, for
 * the admin user list's partnerRole filter (replaces 5+ sequential per-200-id lookups). The repository is stubbed: this checks the grouping.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { partnerController } from "../controllers/partner.controller";
import { partnerRepository } from "../repositories/partner.repository";

function run() {
  let body: any;
  const res = { json: (b: unknown) => { body = b; return res; } } as any;
  return { res, get: () => body };
}

test("role-index groups the staff accounts by role; an empty role is an empty list, OWNER is never listed", async () => {
  const orig = partnerRepository.listNonOwnerAccountRoles;
  (partnerRepository as any).listNonOwnerAccountRoles = async () => [
    { userId: "u1", role: "MANAGER" },
    { userId: "u2", role: "RECEPTIONIST" },
    { userId: "u3", role: "MANAGER" },
  ];
  try {
    const r = run();
    await partnerController.roleIndex({} as any, r.res);
    assert.deepEqual(r.get(), { success: true, data: { MANAGER: ["u1", "u3"], RECEPTIONIST: ["u2"], ACCOUNTANT: [] } });
  } finally {
    (partnerRepository as any).listNonOwnerAccountRoles = orig;
  }
});
