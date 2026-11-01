// Every request body the Tier B builders produce is parsed with the service's REAL zod schema (imported from source with tsx),
// so a schema change in user-service / gym-service breaks THIS test instead of a live seed run.
//   node --import tsx --test scripts/seed-marketplace/__tests__/payloads.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { buildWorld } from "../lib/world/index.mjs";
import * as P from "../lib/tierB/payloads.mjs";

const svc = (...p) => pathToFileURL(path.resolve(import.meta.dirname, "..", "..", "..", "backend", "services", ...p)).href;
const [PTL, GL, APP, GYM, PLAN, AMS] = await Promise.all([
  import(svc("user-service", "src", "services", "pt-listing.schemas.ts")),
  import(svc("gym-service", "src", "services", "gym-listing.schemas.ts")),
  import(svc("gym-service", "src", "schemas", "application.schemas.ts")),
  import(svc("gym-service", "src", "schemas", "gym.schemas.ts")),
  import(svc("gym-service", "src", "schemas", "plan.schemas.ts")),
  import(svc("gym-service", "src", "services", "amenity-selection.schemas.ts")),
]);

const world = buildWorld();
const ok = (schema, value, label) => {
  const r = schema.safeParse(value);
  assert.ok(r.success, `${label}: ${r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3))}`);
};
const bad = (schema, value, label) => assert.ok(!schema.safeParse(value).success, `${label} should be rejected`);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("PT listing payloads (every approved PT, round + tail) satisfy ptListingPayloadSchema", () => {
  for (const pt of world.pts.filter((p) => p.app.state === "APPROVED")) {
    const photoIds = pt.photoFiles.map((_, i) => uuid(i + 1));
    ok(PTL.ptListingPayloadSchema, P.ptListingPayload(pt, { photoIds, coverPhotoId: photoIds[0] ?? null }), pt.slug);
    if (pt.listing.pendingPriceBump) {
      const pk = pt.packages.map((p, i) => P.ptPackagePayload({ ...p, price: pt.listing.pendingPriceBump.pkgIndex === i ? pt.listing.pendingPriceBump.to : p.price }));
      ok(PTL.ptListingPayloadSchema, P.ptListingPayload(pt, { photoIds, coverPhotoId: photoIds[0], packages: pk }), `${pt.slug} price bump`);
    }
    ok(PTL.saveDraftBodySchema, P.ptSaveDraftBody(1, P.ptListingPayload(pt, { photoIds, coverPhotoId: photoIds[0] ?? null })), `${pt.slug} saveDraft`);
  }
  ok(PTL.submitBodySchema, P.submitBody(3), "submit");
  ok(PTL.adminDecisionBodySchema, P.approveBody("Nội dung rõ ràng."), "approve");
  ok(PTL.adminNoteRequiredBodySchema, P.noteBody("Cần bổ sung ảnh."), "reject / request-changes");
  ok(PTL.adminDirectEditBodySchema, P.directEditBody({ profile: { professionalBio: "Mô tả mới." }, reason: "Cập nhật theo yêu cầu qua điện thoại.", expectedListingVersion: 2 }), "direct-edit");
  ok(PTL.presignBodySchema, { contentType: "image/webp" }, "presign");
  bad(PTL.ptListingPayloadSchema, { ...P.ptListingPayload(world.pts[0]), extra: 1 }, "unknown key (strict)");
});

test("gym listing payloads satisfy gymListingPayloadSchema / saveDraft / admin bodies", () => {
  for (const o of world.owners) for (const b of o.branches) {
    const photoIds = b.photoFiles.map((_, i) => uuid(i + 1));
    const payload = P.gymListingPayload({ description: b.description, amenityIds: b.amenities.system.map((s) => `amenity-sys-${s.toLowerCase().replace(/_/g, "-")}`), photoIds, coverPhotoId: photoIds[0] ?? null });
    ok(GL.gymListingPayloadSchema, payload, b.slug);
    ok(GL.saveDraftBodySchema, { expectedDraftVersion: 1, payload }, `${b.slug} saveDraft`);
    assert.ok(b.description.length <= GL.MAX_DESCRIPTION_LENGTH, `${b.slug} description length`);
    assert.ok(photoIds.length <= GL.MAX_GYM_PHOTOS);
  }
  ok(GL.adminApproveBodySchema, P.approveBody("Duyệt."), "approve");
  ok(GL.adminNoteRequiredBodySchema, P.noteBody("Cần sửa mô tả."), "note");
  ok(GL.adminDirectEditBodySchema, P.directEditBody({ description: "Mô tả mới.", reason: "Cập nhật theo yêu cầu của chủ cơ sở.", expectedListingVersion: 1 }), "direct-edit");
});

test("amenity proposal / catalogue bodies satisfy the amenity schemas", () => {
  ok(GL.ownerProposalBodySchema, P.proposalBody(uuid(9), { name: "Phòng boxing", category: "TRAINING_ZONE", note: "Có bao cát." }), "owner proposal");
  ok(GL.adminAmenityCreateBodySchema, P.catalogueCreateBody(world.catalogue[0]), "catalogue create");
  for (const c of world.catalogue) ok(GL.adminAmenityCreateBodySchema, P.catalogueCreateBody(c), c.key);
  ok(GL.adminProposalApproveBodySchema, P.proposalApproveBody([uuid(1)], { category: "TRAINING_ZONE", iconKey: "trophy" }), "approve");
  ok(GL.adminProposalRejectBodySchema, P.proposalRejectBody([uuid(1)], "Tên không phù hợp."), "reject");
  ok(GL.adminProposalMergeBodySchema, P.proposalMergeBody([uuid(1)], "amenity-x"), "merge");
  ok(GL.adminAmenityPatchBodySchema, P.catalogueToggleBody("DISABLED", "Rà soát."), "toggle");
  for (const o of world.owners) for (const b of o.branches) if (b.appProposal) ok(AMS.applicationAmenitiesSchema, { amenityIds: ["amenity-sys-wifi"], proposals: [P.inlineProposal(b.appProposal)] }, `${b.slug} inline proposal`);
  ok(AMS.applicationAmenitiesSchema, { amenityIds: ["amenity-sys-wifi"] }, "application amenities");
  for (const a of world.catalogue) assert.ok(a.name.length <= 40);
});

test("partner application bodies satisfy the application schemas", () => {
  for (const o of world.owners) {
    ok(APP.representativeSchema, P.representativeBody(o), `${o.slug} representative`);
    ok(APP.businessScaleSchema, P.businessScaleBody(o), "scale");
    ok(APP.applicationBrandSchema, P.applicationBrandBody(o), `${o.slug} brand`);
    ok(APP.legalSchema, P.legalBody(o), "legal");
    ok(APP.socialLinksSchema, P.socialBody(o), `${o.slug} social`);
    ok(APP.submitApplicationSchema, P.submitApplicationBody(), "submit");
    const first = o.branches.find((b) => b.firstOfApplication) ?? o.branches[0];
    ok(APP.applicationBranchSchema, P.applicationBranchBody(first), `${first.slug} branch`);
    ok(APP.applicationBranchSchema, P.applicationLocationBody(first), `${first.slug} location`);
    if (o.partner.changes) ok(APP.requestChangesSchema, P.requestChangesBody(o.partner.changes), `${o.slug} request changes`);
    if (o.partner.rejectReason) ok(APP.rejectApplicationSchema, P.rejectApplicationBody(o.partner.rejectReason), "reject");
  }
  ok(APP.presignSchema, { kind: "PHOTO", contentType: "image/webp", sizeBytes: 50000, photoCategory: "EXTERIOR" }, "presign photo");
  ok(APP.presignSchema, { kind: "DOCUMENT", docType: "BUSINESS_LICENSE", contentType: "application/pdf", sizeBytes: 30 }, "presign doc");
});

test("branch (wizard / quick create / hours / operational / plans) bodies satisfy the gym schemas", () => {
  for (const o of world.owners) {
    for (const b of o.branches) {
      const ids = b.amenities.system.map((s) => `amenity-sys-${s.toLowerCase().replace(/_/g, "-")}`);
      ok(GYM.gymDraftUpdateSchema, P.wizardDraftBody(b, ids, 4), `${b.slug} wizard`);
      ok(GYM.gymQuickCreateSchema, P.quickCreateBody(b, ids), `${b.slug} quick`);
      if (b.op && b.opReason) ok(GYM.gymOperationalStatusSchema, P.operationalBody(b), `${b.slug} operational`);
      assert.equal(b.hours.length, 7);
      assert.ok(b.hours.every((d) => d.type !== "OPEN" || (d.openMinute < d.closeMinute && d.closeMinute <= 1439)), `${b.slug} hours`);
    }
    for (const p of o.plans) ok(PLAN.planCreateSchema, P.planBody(p), `${o.slug}/${p.name}`);
  }
});

test("PT application drafts satisfy the submit rules of pt_application.service (so the seed can really submit them)", () => {
  for (const pt of world.pts.filter((p) => p.app.state !== "DRAFT")) {
    const d = P.ptDraftBody(pt, { idCardFrontUrl: "u", idCardBackUrl: "u", portraitPhotoUrl: "u" });
    for (const f of ["phoneNumber", "nationalIdNumber", "currentAddress", "yearsOfExperience", "serviceMode"]) assert.ok(d[f], `${pt.slug}.${f}`);
    assert.ok(d.mainSpecialties.length > 0);
    if (d.serviceMode === "OFFLINE") assert.ok(d.offlinePricePerSession > 0);
    if (d.serviceMode === "HYBRID") assert.ok(d.offlinePricePerSession > 0 && d.onlinePricePerSession > 0);
    assert.ok(d.applicationTrainingLocations.every((l) => l.provinceCode && (l.gymName || l.addressLine)));
    assert.ok(d.sessionsPerPackage > 0);
    assert.ok(d.certificates.length >= 1 && d.certificates.every((c) => c.certificateName));
    assert.ok(String(d.nationalIdNumber).length >= 9);
  }
});

test("contract / membership / review / restriction bodies are well-formed", () => {
  const body = P.contractRequestBody(uuid(1), { id: uuid(2), version: 3 }, uuid(4));
  assert.deepEqual(Object.keys(body).sort(), ["acknowledgedLowAvailability", "clientMessage", "expectedPackageVersion", "gymId", "packageId", "ptUserId"]);
  assert.ok(Number.isInteger(body.expectedPackageVersion) && body.expectedPackageVersion >= 1);
  assert.deepEqual(P.membershipBody("p1"), { planId: "p1", provider: "VNPAY", acknowledgedMultiGymWarning: true });
  assert.equal(P.reviewBody(5, "ok").rating, 5);
  assert.ok(["COMPLAINT_REVIEW", "CONDUCT_REVIEW", "PAYMENT_REVIEW", "DOCUMENT_VERIFICATION", "ACCOUNT_SECURITY", "OTHER"].includes(P.restrictContractBody("DOCUMENT_VERIFICATION", "x", "y").category));
});

test("owner tax codes: valid 10-digit format, unique per owner, deterministic", () => {
  const codes = world.owners.map((o) => o.partner.legal.taxCode);
  for (const c of codes) assert.match(c, /^\d{10}$/, `tax code ${c}`);
  for (const c of codes) assert.ok(APP.TAX_CODE_PATTERN.test(c), `service pattern accepts ${c}`);
  assert.equal(new Set(codes).size, codes.length, "tax codes must be unique per owner");
  assert.deepEqual(buildWorld().owners.map((o) => o.partner.legal.taxCode), codes, "deterministic across builds");
});
