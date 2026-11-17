/**
 * N15M-14 - when the independent-venue warning is required and what the request body carries.
 * Run: npx tsx --test src/app/utils/__tests__/independentVenue.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INDEPENDENT_VENUE_AGREE,
  INDEPENDENT_VENUE_DECLINE,
  INDEPENDENT_VENUE_WARNING,
  isIndependentVenue,
  readIndependentVenueRequired,
  venueAckField,
  venueGate,
} from "../independentVenue";

describe("isIndependentVenue", () => {
  it("offline / hybrid with no Gymini gym is outside the system", () => {
    assert.equal(isIndependentVenue("OFFLINE", null), true);
    assert.equal(isIndependentVenue("OFFLINE", ""), true);
    assert.equal(isIndependentVenue("HYBRID", undefined), true);
  });
  it("online has no venue; a Gymini gym is inside the system", () => {
    assert.equal(isIndependentVenue("ONLINE", null), false);
    assert.equal(isIndependentVenue("OFFLINE", "gym-1"), false);
    assert.equal(isIndependentVenue(undefined, null), false);
  });
});

describe("venueGate - submit is impossible without agreeing", () => {
  it("independent venue, not yet agreed -> dialog first", () => {
    assert.equal(venueGate({ sessionMode: "OFFLINE", gymId: null, acknowledged: false }), "dialog");
  });
  it("independent venue, agreed -> send", () => {
    assert.equal(venueGate({ sessionMode: "OFFLINE", gymId: null, acknowledged: true }), "send");
  });
  it("online or gym contract never shows the dialog", () => {
    assert.equal(venueGate({ sessionMode: "ONLINE", gymId: null, acknowledged: false }), "send");
    assert.equal(venueGate({ sessionMode: "OFFLINE", gymId: "g1", acknowledged: false }), "send");
  });
});

describe("venueAckField", () => {
  it("is only ever the literal true, only for an independent venue that was agreed to", () => {
    assert.deepEqual(venueAckField({ sessionMode: "OFFLINE", gymId: null, acknowledged: true }), { acknowledgedIndependentVenue: true });
    assert.deepEqual(venueAckField({ sessionMode: "OFFLINE", gymId: null, acknowledged: false }), {});
    assert.deepEqual(venueAckField({ sessionMode: "ONLINE", gymId: null, acknowledged: true }), {});
    assert.deepEqual(venueAckField({ sessionMode: "OFFLINE", gymId: "g1", acknowledged: true }), {});
  });
});

describe("copy and server answer", () => {
  it("states the non-responsibility and offers two clear choices", () => {
    assert.match(INDEPENDENT_VENUE_WARNING, /Gymini không chịu trách nhiệm/);
    assert.match(INDEPENDENT_VENUE_WARNING, /hai bên/);
    assert.equal(INDEPENDENT_VENUE_AGREE, "Tôi đồng ý");
    assert.equal(INDEPENDENT_VENUE_DECLINE, "Chọn gói/PT khác");
  });
  it("reads the server's 409 by code only", () => {
    assert.equal(readIndependentVenueRequired({ response: { status: 409, data: { code: "INDEPENDENT_VENUE_ACK_REQUIRED" } } }), true);
    assert.equal(readIndependentVenueRequired({ response: { status: 409, data: { code: "LOW_AVAILABILITY" } } }), false);
    assert.equal(readIndependentVenueRequired({ response: { status: 422, data: { code: "INDEPENDENT_VENUE_ACK_REQUIRED" } } }), false);
    assert.equal(readIndependentVenueRequired(undefined), false);
  });
});
