import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { adminRoleBreakdown, adminRoleLabel, adminUserStatus } from "../utils/adminUserView";

describe("GAP-21 — admin user labels", () => {
  it("gym owners are not clients", () => {
    assert.equal(adminRoleLabel("GYM_OWNER"), "Gym Owner");
    assert.equal(adminRoleLabel("PT"), "PT");
    assert.equal(adminRoleLabel("ADMIN"), "Admin");
    assert.equal(adminRoleLabel("CUSTOMER"), "Client");
    assert.equal(adminRoleLabel(undefined), "Client");
  });

  it("status comes from auth-service isActive", () => {
    assert.equal(adminUserStatus(false), "Inactive");
    assert.equal(adminUserStatus(true), "Active");
    assert.equal(adminUserStatus(undefined), "Active");
  });

  it("role breakdown has a gym-owner slice", () => {
    const users = [
      { id: "a", role: "CUSTOMER" },
      { id: "b", role: "CUSTOMER" },
      { id: "c", role: "PT" },
      { id: "d", role: "GYM_OWNER" },
    ];
    const ptProfiles = new Set(["b"]);
    const out = adminRoleBreakdown(users, (u) => u.role === "PT" || ptProfiles.has(u.id));
    assert.deepEqual(out, [
      { name: "Clients", value: 2 },
      { name: "Trainers", value: 2 },
      { name: "Gym owners", value: 1 },
    ]);
  });
});
