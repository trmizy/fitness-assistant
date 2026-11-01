#!/usr/bin/env node
// Teardown for g-owner-amenity-disabled.yaml (REAL HTTP/API).
//   - owner: withdraw a PENDING revision the flow submitted, then discard the open revision (no admin decision is recorded)
//   - admin: the catalogue row "E2E Maestro Zone" stays DISABLED (a catalogue row cannot be deleted, and switching it back ON
//     would put an E2E chip into every owner's picker). REENABLE=1 switches it back ON instead.
// Env: SEED_PASSWORD (required), ADMIN_EMAIL + ADMIN_PASSWORD (only with REENABLE=1), GATEWAY_URL.
// Reads helpers/.state/g-amenity.json.
import { FLOW2, call, dropState, loadState, loginAdmin, loginSeed, log, run, unwrap } from "./lib.mjs";

run(async () => {
  const st = loadState("g-amenity");
  if (!st) throw new Error("no helpers/.state/g-amenity.json - nothing to tear down (did the setup run on this machine?)");
  const owner = await loginSeed(st.ownerSlug);
  const view = async () => unwrap(await call("GET", `/owner/gyms/${st.gymId}/listing`, { token: owner, expect: [200] }));

  let v = await view();
  if (v.openRevision?.status === "PENDING") {
    await call("POST", `/owner/gyms/${st.gymId}/listing/withdraw`, { token: owner, body: {}, headers: FLOW2, expect: [200] });
    log("PENDING revision withdrawn");
    v = await view();
  }
  if (v.openRevision) {
    await call("POST", `/owner/gyms/${st.gymId}/listing/discard`, { token: owner, body: {}, headers: FLOW2, expect: [200] });
    log(`open ${v.openRevision.status} revision discarded`);
    v = await view();
  }
  if (v.openRevision) throw new Error(`a revision is still open (${v.openRevision.status})`);

  if (process.env.REENABLE === "1") {
    const admin = await loginAdmin();
    await call("PATCH", `/admin/amenities/${st.amenityId}`, {
      token: admin,
      body: { status: "ACTIVE", reason: "E2E Maestro: ket thuc luong g" },
      expect: [200],
    });
    log("catalogue amenity switched back ON (REENABLE=1)");
  } else {
    log('catalogue amenity "E2E Maestro Zone" left DISABLED (REENABLE=1 switches it on)');
  }
  dropState("g-amenity");
  log("CLEAN: branch has no open revision");
});
