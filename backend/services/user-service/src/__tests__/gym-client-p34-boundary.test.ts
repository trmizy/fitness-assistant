import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";

/**
 * Phase 3 / P3.4 - the two gym-service reads added to gymClient, at the axios boundary (TEST FIXTURE,
 * no database). The rule under test: only a definite "branch unknown" (404) is a normal answer; every
 * other failure is GymServiceUnavailableError, never an empty list or "no membership".
 */
function stubGet(impl: (url: string, cfg: any) => Promise<any>): () => void {
  const original = axios.get;
  (axios as any).get = impl;
  return () => {
    (axios as any).get = original;
  };
}

test("listAcceptedGymsForPt: calls the public picker path and returns data.data", async () => {
  let seen = "";
  const restore = stubGet(async (url) => {
    seen = url;
    return { data: { success: true, data: [{ collaborationId: "a", gym: { id: "g1", name: "G" } }] } };
  });
  try {
    const rows = await gymClient.listAcceptedGymsForPt("pt/1");
    assert.match(seen, /\/pt\/pt%2F1\/gyms$/);
    assert.equal(rows[0].gym.id, "g1");
  } finally {
    restore();
  }
});

test("listAcceptedGymsForPt: network error, 5xx and a malformed body are all Unavailable (never an empty list)", async () => {
  for (const impl of [
    async () => { throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }); },
    async () => { throw Object.assign(new Error("boom"), { response: { status: 500 } }); },
    async () => ({ data: { success: true } }),
  ]) {
    const restore = stubGet(impl as any);
    try {
      await assert.rejects(gymClient.listAcceptedGymsForPt("pt"), GymServiceUnavailableError);
    } finally {
      restore();
    }
  }
});

test("getClientMembershipAtGym: sends the service secret and gymId; 404 -> null; other failures -> Unavailable", async () => {
  let cfg: any;
  let url = "";
  let restore = stubGet(async (u, c) => {
    url = u;
    cfg = c;
    return { data: { success: true, data: { hasActiveMembership: true, brandId: "b", membership: { membershipId: "m", planName: "P", purchaseGymId: "g", startDate: null, endDate: null } } } };
  });
  try {
    const r = await gymClient.getClientMembershipAtGym("client-1", "gym-1");
    assert.match(url, /\/internal\/clients\/client-1\/active-memberships$/);
    assert.deepEqual(cfg.params, { gymId: "gym-1" });
    assert.ok(cfg.headers["x-service-secret"]);
    assert.equal(r!.hasActiveMembership, true);
  } finally {
    restore();
  }

  restore = stubGet(async () => { throw Object.assign(new Error("nf"), { response: { status: 404 } }); });
  try {
    assert.equal(await gymClient.getClientMembershipAtGym("c", "gone"), null);
  } finally {
    restore();
  }

  for (const impl of [
    async () => { throw Object.assign(new Error("x"), { response: { status: 500 } }); },
    async () => { throw Object.assign(new Error("x"), { response: { status: 401 } }); },
    async () => ({ data: { success: true, data: { nope: 1 } } }),
  ]) {
    restore = stubGet(impl as any);
    try {
      await assert.rejects(gymClient.getClientMembershipAtGym("c", "g"), GymServiceUnavailableError);
    } finally {
      restore();
    }
  }
});
