#!/usr/bin/env node
// Setup for g-owner-amenity-disabled.yaml (REAL HTTP/API through the gateway).
//
//   1. admin: make sure the catalogue amenity "E2E Maestro Zone" exists and is ACTIVE (created through POST /admin/amenities)
//   2. owner (default trinh-gia-bao, O4): open a DRAFT revision on the chosen branch and add that amenity to it
//   3. admin: switch the amenity OFF  -> the server removes it from every open draft and records an AMENITY_DISABLED_REMOVED
//      adjustment, which is what the app turns into "Một số tiện ích đã ngừng trong danh mục" + "Đề xuất bật lại"
//
// Env: SEED_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD (required); GATEWAY_URL, OWNER_SLUG (default trinh-gia-bao),
//      BRANCH_MATCH (ASCII, accent-insensitive part of the branch name, default "cau giay"), GYM_ID (overrides BRANCH_MATCH),
//      FORCE_DISCARD=1 (discard an existing DRAFT of the branch; a PENDING one always aborts).
// Writes helpers/.state/g-amenity.json (ids only) for the teardown.
import { FLOW2, call, fold, loginAdmin, loginSeed, log, run, saveState, unwrap } from "./lib.mjs";

const AMENITY_NAME = "E2E Maestro Zone";

async function findAmenity(admin, name) {
  const list = unwrap(await call("GET", "/admin/amenities", { token: admin, expect: [200] }));
  const rows = Array.isArray(list) ? list : list?.amenities ?? [];
  return rows.find((a) => fold(a.name) === fold(name)) ?? null;
}

async function pickGym(owner) {
  const gyms = unwrap(await call("GET", "/owner/gyms", { token: owner, expect: [200] }));
  const rows = Array.isArray(gyms) ? gyms : gyms?.gyms ?? [];
  if (process.env.GYM_ID) return rows.find((g) => g.id === process.env.GYM_ID) ?? { id: process.env.GYM_ID, name: "(GYM_ID)" };
  const want = fold(process.env.BRANCH_MATCH || "cau giay");
  const hits = rows.filter((g) => fold(g.name).includes(want));
  if (hits.length !== 1) throw new Error(`BRANCH_MATCH "${want}" matched ${hits.length} of the owner's ${rows.length} branches (need exactly 1). Set GYM_ID.`);
  return hits[0];
}

const readListing = async (owner, gymId) => unwrap(await call("GET", `/owner/gyms/${gymId}/listing`, { token: owner, expect: [200] }));

run(async () => {
  const admin = await loginAdmin();
  const ownerSlug = process.env.OWNER_SLUG || "trinh-gia-bao";
  const owner = await loginSeed(ownerSlug);
  const gym = await pickGym(owner);
  log(`branch: ${gym.name} (${gym.id})`);

  let view = await readListing(owner, gym.id);
  if (view.openRevision) {
    const st = view.openRevision.status;
    if (st === "DRAFT" && process.env.FORCE_DISCARD === "1") {
      await call("POST", `/owner/gyms/${gym.id}/listing/discard`, { token: owner, body: {}, headers: FLOW2, expect: [200] });
      log("existing DRAFT discarded (FORCE_DISCARD=1)");
      view = await readListing(owner, gym.id);
    } else {
      throw new Error(`the branch already has an open revision (${st}). Resolve it first, or FORCE_DISCARD=1 for a DRAFT.`);
    }
  }

  // 1. catalogue amenity, ACTIVE
  let amenity = await findAmenity(admin, AMENITY_NAME);
  let created = false;
  if (!amenity) {
    const r = await call("POST", "/admin/amenities", {
      token: admin,
      body: { name: AMENITY_NAME, category: "TRAINING_ZONE", iconKey: "star", sortOrder: 900 },
      expect: [200, 201],
    });
    amenity = unwrap(r)?.amenity ?? unwrap(r);
    created = true;
    log(`catalogue amenity created: ${AMENITY_NAME}`);
  } else if (amenity.status !== "ACTIVE") {
    await call("PATCH", `/admin/amenities/${amenity.id}`, {
      token: admin,
      body: { status: "ACTIVE", reason: "E2E Maestro: bat lai de dung cho luong g" },
      expect: [200],
    });
    log("catalogue amenity re-enabled for the run");
  }
  if (!amenity?.id) throw new Error("could not resolve the E2E amenity id");

  // 2. owner draft containing it
  await call("POST", `/owner/gyms/${gym.id}/listing/draft`, { token: owner, body: {}, headers: FLOW2, expect: [200, 201] });
  view = await readListing(owner, gym.id);
  const rev = view.openRevision;
  if (!rev) throw new Error("draft was not created");
  const payload = { ...rev.payload, amenityIds: [...new Set([...(rev.payload.amenityIds ?? []), amenity.id])] };
  await call("PUT", `/owner/gyms/${gym.id}/listing/draft`, {
    token: owner,
    body: { expectedDraftVersion: rev.draftVersion, payload },
    headers: FLOW2,
    expect: [200],
  });
  log("owner draft saved with the E2E amenity inside");

  // 3. admin switches it OFF
  await call("PATCH", `/admin/amenities/${amenity.id}`, {
    token: admin,
    body: { status: "DISABLED", reason: "E2E Maestro: tat tien ich de kiem thong bao cho chu phong gym" },
    expect: [200],
  });
  view = await readListing(owner, gym.id);
  const adj = (view.openRevision?.systemAdjustments ?? []).find((a) => a.type === "AMENITY_DISABLED_REMOVED" && a.amenityId === amenity.id);
  if (!adj) throw new Error("the draft has no AMENITY_DISABLED_REMOVED adjustment after the switch-off");
  if ((view.openRevision?.payload?.amenityIds ?? []).includes(amenity.id)) throw new Error("the disabled amenity is still in the draft");

  saveState("g-amenity", {
    gymId: gym.id,
    gymName: gym.name,
    amenityId: amenity.id,
    amenityName: AMENITY_NAME,
    ownerSlug,
    amenityCreatedByRun: created,
    at: new Date().toISOString(),
  });
  log(`READY: draft revision ${view.openRevision.id} (${view.openRevision.status}) has the AMENITY_DISABLED_REMOVED notice for "${AMENITY_NAME}".`);
  log(`Run the flow with -e EMAIL=${ownerSlug}@seed.gymini.test -e BRANCH_TAP=<ASCII regex of the branch name>; then run g-amenity-teardown.mjs.`);
});
