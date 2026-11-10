/**
 * TEST FIXTURE: fake HTTP only (no browser, no backend). ND-07 - the gym owner / manager complaint-case client.
 * Run: npx tsx --test src/app/pages/gym-owner/__tests__/owner-complaint-cases.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGymCaseApi, type GymHttpClient } from "../../admin/complaints/gymCaseApi";
import { gymQueryKeys } from "../../admin/complaints/gymCaseQueryKeys";

type Sent = { method: string; url: string; data?: Record<string, unknown>; headers?: Record<string, string> };

function fake(reply: unknown, status = 200) {
  const calls: Sent[] = [];
  const client: GymHttpClient = {
    request: async (config) => {
      calls.push(config as Sent);
      return { status, data: { success: true, data: reply } as never };
    },
  };
  return { api: createGymCaseApi(client), calls };
}

describe("ND-07 owner complaint-case client", () => {
  it("reads go to /owner/complaint-cases and unwrap the envelope", async () => {
    const { api, calls } = fake({ items: [{ id: "c1", gymId: "g1", issueType: "CLEANLINESS", progress: "Đã tiếp nhận", canSubmit: true, respondBy: null, createdAt: "2026-11-01T00:00:00Z" }] });
    const list = await api.listOwner();
    assert.equal(list.items[0].id, "c1");
    assert.deepEqual([calls[0].method, calls[0].url], ["GET", "/owner/complaint-cases"]);
    await api.getOwner("a/b");
    assert.equal(calls[1].url, "/owner/complaint-cases/a%2Fb", "the case id is URL-encoded");
  });

  it("an explanation is an idempotent POST with only text / supplementReason (no actor, gym, amount or outcome)", async () => {
    const { api, calls } = fake({ id: "s1", version: 1 }, 201);
    await api.submitOwnerExplanation("c1", { text: "Phòng đã vệ sinh lại", supplementReason: undefined, ...({ userId: "evil", gymId: "g9", amount: 5 } as object) } as never, "key-1");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "/owner/complaint-cases/c1/explanations");
    assert.equal(calls[0].headers?.["Idempotency-Key"], "key-1");
    assert.deepEqual(calls[0].data, { text: "Phòng đã vệ sinh lại" });
  });

  it("evidence carries description + declared sha256 (+ optional title / fileName) only", async () => {
    const { api, calls } = fake({ id: "e1" }, 201);
    const sha = "a".repeat(64);
    await api.submitOwnerEvidence("c1", { description: "Biên bản vệ sinh", sha256: sha, title: "Biên bản", ...({ clientId: "x" } as object) } as never, "key-2");
    assert.equal(calls[0].url, "/owner/complaint-cases/c1/evidence");
    assert.deepEqual(calls[0].data, { description: "Biên bản vệ sinh", sha256: sha, title: "Biên bản" });
  });

  it("a write without a valid Idempotency-Key never leaves the browser", async () => {
    const { api, calls } = fake({});
    await assert.rejects(() => api.submitOwnerExplanation("c1", { text: "x" }, "bad key!"), /INVALID_IDEMPOTENCY_KEY/);
    assert.equal(calls.length, 0);
  });

  it("owner query keys are scoped by user id (account switch never serves the previous user's cases)", () => {
    const a = gymQueryKeys("user-a");
    const b = gymQueryKeys("user-b");
    assert.notDeepEqual(a.ownerList(), b.ownerList());
    assert.deepEqual(a.ownerDetail("c1").slice(0, 2), ["gym-complaint", "user-a"]);
  });
});

describe("ND-07 wiring (CODE AUDIT of the source text)", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  it("route is guarded by the complaintCases staff feature; sidebar and notification link exist", () => {
    const routes = read("../../../routes.tsx");
    assert.match(routes, /path: "complaint-cases", element: <RequireStaffFeature feature="complaintCases">/);
    assert.match(routes, /path: "complaint-cases\/:caseId", element: <RequireStaffFeature feature="complaintCases">/);
    const sidebar = read("../../../components/layout/Sidebar.tsx");
    assert.match(sidebar, /to: "\/gym-owner\/complaint-cases" \}/, "owner and manager both see it (not ownerOnly)");
    const topbar = read("../../../components/layout/Topbar.tsx");
    assert.match(topbar, /role === "gym_owner" \? "\/gym-owner\/complaint-cases"/);
  });

  it("ND-01 / ND-02: owner-only reads are not fired for roles the server refuses (403)", () => {
    const dash = read("../GymOwnerDashboard.tsx");
    assert.match(dash, /getOwnedWallet\(activeGymId\),\s+enabled: !!activeGymId && showWallet/);
    assert.match(dash, /collaborationService\.listForOwner\(\),\s+enabled: showCollaborations/);
    const manage = read("../GymManagePage.tsx");
    assert.match(manage, /getOwnedWallet\(id!\),\s+enabled: !!id && canSeeWallet/);
    assert.match(manage, /listGymWithdrawals\(id!\),\s+enabled: !!id && canSeeWallet/);
    const profile = read("../GymOwnerProfilePage.tsx");
    assert.match(profile, /listOwnedBrands\(\),\s+enabled: canViewBrands\(/);
  });
});
