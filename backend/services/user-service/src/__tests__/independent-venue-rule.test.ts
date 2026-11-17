import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INDEPENDENT_VENUE_CONSENT_VERSION,
  hasVenueConsentCapability,
  isIndependentVenue,
  legacyVenueGraceActive,
} from "../services/independent-venue-consent";

/** Pure unit test of the rule (N15M-14): no database, no fixtures. */
test("independent venue = not online AND no Gymini gym", () => {
  assert.equal(isIndependentVenue("OFFLINE", null), true);
  assert.equal(isIndependentVenue("OFFLINE", undefined), true);
  assert.equal(isIndependentVenue("OFFLINE", ""), true);
  assert.equal(isIndependentVenue("HYBRID", null), true);
  assert.equal(isIndependentVenue("ONLINE", null), false);
  assert.equal(isIndependentVenue("OFFLINE", "gym-1"), false);
  assert.equal(isIndependentVenue("HYBRID", "gym-1"), false);
  assert.equal(isIndependentVenue(null, null), false);
  assert.match(INDEPENDENT_VENUE_CONSENT_VERSION, /^independent-venue-/);
});

test("capability header: only a plain integer >= 1 marks a NEW client", () => {
  assert.equal(hasVenueConsentCapability("1"), true);
  assert.equal(hasVenueConsentCapability(" 2 "), true);
  assert.equal(hasVenueConsentCapability(["1"]), true);
  for (const bad of [undefined, null, "", "0", "-1", "abc", "1.5", "1,2", "true", "9999999", []]) {
    assert.equal(hasVenueConsentCapability(bad as any), false, String(bad));
  }
});

test("legacy grace: default ON; off by flag; off from the cutoff instant; a bad date is ignored", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  assert.equal(legacyVenueGraceActive({}, now), true);
  for (const off of ["false", "FALSE", "0", "off", "no", " no "]) {
    assert.equal(legacyVenueGraceActive({ INDEPENDENT_VENUE_LEGACY_GRACE: off }, now), false, off);
  }
  assert.equal(legacyVenueGraceActive({ INDEPENDENT_VENUE_LEGACY_GRACE: "true" }, now), true);
  assert.equal(legacyVenueGraceActive({ INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL: "2026-12-01T00:00:00Z" }, now), true);
  assert.equal(legacyVenueGraceActive({ INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL: "2026-11-16T00:00:00Z" }, now), false);
  assert.equal(legacyVenueGraceActive({ INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL: "2026-01-01" }, now), false);
  assert.equal(legacyVenueGraceActive({ INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL: "not-a-date" }, now), true);
});
