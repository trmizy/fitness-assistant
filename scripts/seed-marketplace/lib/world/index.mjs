// The whole seed universe as plain data. Pure and deterministic: same code + same assets => the same world, byte for byte.
import { NameBook } from "../names.mjs";
import { resetPhysiqueCursor, resetPoolCursors } from "./assets.mjs";
import { buildClients } from "./clients.mjs";
import { buildOwners } from "./owners.mjs";
import { buildPts } from "./pts.mjs";
import { CUSTOM_CATALOGUE_AMENITIES } from "./constants.mjs";

export function buildWorld() {
  resetPoolCursors();
  resetPhysiqueCursor();
  const names = new NameBook("marketplace");
  // fixed names first (owners + PTs reserve theirs), so generated people can never collide with them
  const owners = buildOwners(names);
  const pts = buildPts(names);
  const clients = buildClients(names);
  // Amenity-catalogue scenarios that are not tied to a single branch's listing (plan 8.1 "đề xuất MERGED / REENABLE").
  const o1 = owners.find((o) => o.n === 1);
  const amenityScenarios = {
    // MERGED: the owner proposes a near-duplicate of a catalogue amenity; the admin merges it into "Khu stretching".
    merged: { ownerSlug: o1.slug, branchKey: o1.branches[1].key, name: "Khu giãn cơ", category: "TRAINING_ZONE", note: "Khu để giãn cơ sau buổi tập.", mergeInto: "stretching" },
    // REENABLE: the admin switches "Khăn tập" OFF in the catalogue, then an owner proposes it again (the proposal is a REENABLE, left PENDING).
    reenable: { ownerSlug: o1.slug, branchKey: o1.branches[0].key, name: "Khăn tập", category: "SERVICE", disableKey: "gym-towel" },
  };
  return { owners, pts, clients, catalogue: CUSTOM_CATALOGUE_AMENITIES, amenityScenarios, names };
}

export function summarize(world) {
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  const branches = world.owners.flatMap((o) => o.branches);
  return {
    clients: world.clients.length,
    clientsWithInbody: world.clients.filter((c) => c.inbody.length).length,
    pts: world.pts.length,
    ptApplication: count(world.pts, (p) => p.app.state),
    ptListing: count(world.pts.filter((p) => p.app.state === "APPROVED"), (p) => p.listing.kind),
    ptFlags: {
      suspended: world.pts.filter((p) => p.flags.suspended).length,
      accountRestricted: world.pts.filter((p) => p.flags.accountRestricted).length,
      contractRestricted: world.pts.filter((p) => p.flags.contractRestricted).length,
      notAccepting: world.pts.filter((p) => p.flags.notAccepting).length,
    },
    ptPhotos: count(world.pts.filter((p) => p.app.state === "APPROVED"), (p) => p.photoFiles.length),
    ptPackages: count(world.pts.filter((p) => p.app.state === "APPROVED"), (p) => (p.packages.length === 0 ? "0" : p.packages.length <= 3 ? "1-3" : "4+")),
    ptInactivePackages: world.pts.filter((p) => p.packages.some((k) => !k.isActive)).length,
    owners: world.owners.length,
    ownerStates: count(world.owners, (o) => o.partner.state),
    branches: branches.length,
    branchStatus: count(branches, (b) => `${b.status}${b.op ? "/" + b.op : ""}`),
    branchListing: count(branches, (b) => b.listing.finalKind),
    branchPhotos: { max: Math.max(...branches.map((b) => b.photoFiles.length)), exactly20: branches.filter((b) => b.photoFiles.length === 20).length, zero: branches.filter((b) => b.photoFiles.length === 0).length },
    branchesZeroAmenities: branches.filter((b) => b.amenities.system.length + b.amenities.custom.length === 0).length,
    proposals: branches.filter((b) => b.appProposal).length,
    plans: world.owners.reduce((n, o) => n + o.plans.length, 0),
  };
}
