/**
 * Listing Management D2 - the partner application wizard has 10 steps; the amenity step sits between Location and Photos and the
 * server's `missing` key AMENITIES resumes there. Also the new-client headers and the legacy facility table.
 * Run: npx tsx --test src/app/utils/__tests__/applicationSteps.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_STEP, SECTION_TO_STEP, STEPS, firstIncompleteIndex, stepIndexOf, stepIsDone } from "../applicationSteps";
import { CLIENT_HEADER, LISTING_FLOW_HEADER, clientHeaderValue, isListingFlowRequest, listingFlowHeaders } from "../../services/listingFlow";
import { FACILITY_LABEL, SYSTEM_FACILITIES, isGymFacility } from "../facilityLabels";
import { AMENITY_ICON_KEYS } from "../amenityIcons";

describe("application steps", () => {
  it("has 10 steps, with Tiện ích as the 7th, between Vị trí and Ảnh cơ sở", () => {
    assert.equal(STEPS.length, 10);
    assert.deepEqual(STEPS.map((s) => s.id), ["representative", "brand", "social", "scale", "branch", "location", "amenities", "photos", "legal", "review"]);
    assert.equal(STEPS[6].title, "Tiện ích");
    assert.equal(stepIndexOf("amenities"), 6);
    assert.equal(STEPS[stepIndexOf("location") + 1].id, "amenities");
    assert.equal(STEPS[stepIndexOf("amenities") + 1].id, "photos");
  });

  it("every server `missing` section maps to exactly one step that lists it", () => {
    for (const [section, stepId] of Object.entries(SECTION_TO_STEP)) {
      const step = STEPS.find((s) => s.id === stepId)!;
      assert.ok(step, section);
      assert.ok(step.sections.includes(section as never), `${stepId} must list ${section}`);
    }
    assert.equal(SECTION_TO_STEP.AMENITIES, "amenities");
  });

  it("resume lands on the amenity step when AMENITIES is the first thing missing", () => {
    const missing = [{ section: "AMENITIES" as const }, { section: "PHOTOS" as const }, { section: "LEGAL" as const }, { section: "TERMS" as const }];
    assert.equal(STEPS[firstIncompleteIndex(missing)].id, "amenities");
  });

  it("an earlier gap still wins; nothing missing (but terms) lands on the review", () => {
    assert.equal(STEPS[firstIncompleteIndex([{ section: "LOCATION" }, { section: "AMENITIES" }])].id, "location");
    assert.equal(STEPS[firstIncompleteIndex([{ section: "TERMS" }])].id, "review");
    assert.equal(STEPS[firstIncompleteIndex([])].id, "review");
  });

  it("a step is done when none of its sections is missing; the social step has no section and is always done", () => {
    const amenities = STEPS[stepIndexOf("amenities")];
    assert.equal(stepIsDone(amenities, [{ section: "AMENITIES" }]), false);
    assert.equal(stepIsDone(amenities, [{ section: "PHOTOS" }]), true);
    assert.equal(stepIsDone(STEPS[stepIndexOf("social")], [{ section: "BRAND" }]), true);
  });

  it("an admin's AMENITIES change request points at the amenity step; every category has a step", () => {
    assert.equal(CATEGORY_STEP.AMENITIES, "amenities");
    for (const step of Object.values(CATEGORY_STEP)) assert.ok(STEPS.some((s) => s.id === step), step);
  });
});

describe("new-client headers (X-Gymini-Listing-Flow: 2)", () => {
  it("rides on every /owner/application call and the add-branch wizard's create / draft / submit", () => {
    assert.equal(isListingFlowRequest("get", "/owner/application"), true);
    assert.equal(isListingFlowRequest("PUT", "/owner/application/amenities"), true);
    assert.equal(isListingFlowRequest("post", "/owner/application/submit"), true);
    assert.equal(isListingFlowRequest("post", "/owner/application/resubmit"), true);
    assert.equal(isListingFlowRequest("get", "/owner/application?x=1"), true);
    assert.equal(isListingFlowRequest("POST", "/owner/gyms/draft"), true);
    assert.equal(isListingFlowRequest("PATCH", "/owner/gyms/6f1c/draft"), true);
    assert.equal(isListingFlowRequest("POST", "/owner/gyms/6f1c/submit"), true);
    assert.equal(isListingFlowRequest("POST", "https://host/api/owner/gyms/draft"), true);
    assert.equal(isListingFlowRequest("POST", "/owner/gyms"), true, "quick create (MyGymsPage) now has an amenity step");
    assert.equal(isListingFlowRequest("GET", "/owner/application/amenities/catalog"), true);
  });

  it("and on nothing else (listing workflow, amenities, hours, quick create, other services)", () => {
    for (const [m, u] of [
      ["GET", "/owner/gyms"],
      ["GET", "/owner/gyms/6f1c"],
      ["PUT", "/owner/gyms/6f1c/listing/draft"],
      ["POST", "/owner/gyms/6f1c/listing/submit"],
      ["POST", "/owner/gyms/6f1c/listing/photos/presign"],
      ["GET", "/owner/amenities"],
      ["POST", "/owner/amenities/proposals"],
      ["GET", "/owner/gyms/draft"],
      ["PATCH", "/owner/gyms/6f1c"],
      ["GET", "/gyms"],
      ["POST", "/auth/login"],
    ] as const) {
      assert.equal(isListingFlowRequest(m, u), false, `${m} ${u}`);
      assert.equal(listingFlowHeaders(m, u), null, `${m} ${u}`);
    }
  });

  it("sends flow '2' and a web client label (measured only)", () => {
    const h = listingFlowHeaders("PUT", "/owner/application/amenities", "0.0.1")!;
    assert.equal(h[LISTING_FLOW_HEADER], "2");
    assert.equal(h[CLIENT_HEADER], "web/0.0.1");
    assert.equal(clientHeaderValue("x".repeat(500)).length, 120);
    assert.equal(clientHeaderValue(""), "web/0");
  });
});

describe("legacy facility mirror and the standard catalogue", () => {
  it("covers the 18 SYSTEM amenities with names, a catalogue category and an allowed icon", () => {
    assert.equal(Object.keys(SYSTEM_FACILITIES).length, 18);
    for (const [slug, meta] of Object.entries(SYSTEM_FACILITIES)) {
      assert.ok(meta.name, slug);
      assert.ok((AMENITY_ICON_KEYS as readonly string[]).includes(meta.iconKey), `${slug}: ${meta.iconKey}`);
    }
    assert.equal(FACILITY_LABEL.FREE_WEIGHTS, "Tạ tự do");
  });

  it("isGymFacility tells the 18 enum values from anything else (unknown values stay visible as text)", () => {
    assert.equal(isGymFacility("WIFI"), true);
    assert.equal(isGymFacility("NOPE"), false);
  });
});
