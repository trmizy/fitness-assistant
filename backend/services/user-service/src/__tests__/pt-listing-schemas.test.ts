/**
 * PT listing management, phase C2 - pure unit tests (no database): the strict payload schemas and the diff.
 * Evidence label: unit test of pure functions (no I/O).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ListingError,
  adminDirectEditBodySchema,
  parseOrThrow,
  ptListingPayloadSchema,
  saveDraftBodySchema,
} from "../services/pt-listing.schemas";
import { diffPayloads } from "../services/pt-listing-diff";
import { detectImageType } from "../services/pt-physique-upload.service";

const profile = {
  professionalBio: "bio",
  mainSpecialties: ["A"],
  trainingMethodsApproach: null,
  targetClientGroups: [],
  primaryTrainingGoals: [],
  languages: ["vi"],
  websiteUrl: null,
  linkedinUrl: null,
};
const payload = () => ({ profile: { ...profile }, packages: [], photoIds: [], coverPhotoId: null });

test("payload schema is strict at every level and normalizes text", () => {
  assert.ok(ptListingPayloadSchema.safeParse(payload()).success);
  assert.equal(ptListingPayloadSchema.safeParse({ ...payload(), x: 1 }).success, false);
  assert.equal(ptListingPayloadSchema.safeParse({ ...payload(), profile: { ...profile, phoneNumber: "1" } }).success, false);
  assert.equal(
    ptListingPayloadSchema.safeParse({ ...payload(), packages: [{ name: "a", price: 1, sessionCount: 1, sessionMode: "ONLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true, ptUserId: "x" }] }).success,
    false,
    "a package cannot carry ptUserId / version / archivedAt",
  );
  const r = ptListingPayloadSchema.parse({ ...payload(), profile: { ...profile, professionalBio: "   ", mainSpecialties: ["A", "A", "B"], websiteUrl: "" } });
  assert.equal(r.profile.professionalBio, null);
  assert.deepEqual(r.profile.mainSpecialties, ["A", "B"]);
  assert.equal(r.profile.websiteUrl, null);
  assert.equal(ptListingPayloadSchema.safeParse({ ...payload(), profile: { ...profile, websiteUrl: "javascript:alert(1)" } }).success, false);
  assert.equal(ptListingPayloadSchema.safeParse({ ...payload(), profile: { ...profile, professionalBio: "x".repeat(2001) } }).success, false);
  assert.equal(ptListingPayloadSchema.safeParse({ ...payload(), photoIds: ["not-a-uuid"] }).success, false);
  for (const bad of [{ price: 0 }, { price: -5 }, { sessionCount: 0 }, { sessionCount: 1.5 }, { sessionMode: "HYBRID" }, { sessionDurationMinutes: 10 }, { name: "" }]) {
    assert.equal(
      ptListingPayloadSchema.safeParse({ ...payload(), packages: [{ name: "a", price: 1, sessionCount: 1, sessionMode: "ONLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true, ...bad }] }).success,
      false,
      JSON.stringify(bad),
    );
  }
});

test("request bodies: draft save needs expectedDraftVersion; admin direct edit needs reason >= 10 chars and expectedListingVersion", () => {
  assert.equal(saveDraftBodySchema.safeParse({ payload: payload() }).success, false);
  assert.ok(saveDraftBodySchema.safeParse({ expectedDraftVersion: 1, payload: payload() }).success);
  assert.equal(saveDraftBodySchema.safeParse({ expectedDraftVersion: 0, payload: payload() }).success, false);
  assert.equal(adminDirectEditBodySchema.safeParse({ reason: "short", expectedListingVersion: 1, profile: { professionalBio: "x" } }).success, false);
  assert.equal(adminDirectEditBodySchema.safeParse({ reason: "đủ mười ký tự rồi", profile: { professionalBio: "x" } }).success, false);
  assert.ok(adminDirectEditBodySchema.safeParse({ reason: "đủ mười ký tự rồi", expectedListingVersion: 3, profile: { professionalBio: "x" } }).success);
  assert.equal(adminDirectEditBodySchema.safeParse({ reason: "đủ mười ký tự rồi", expectedListingVersion: 3, profile: { nationalIdNumber: "x" } }).success, false);
  assert.throws(() => parseOrThrow(saveDraftBodySchema, {}), (e: unknown) => e instanceof ListingError && e.status === 400 && e.code === "VALIDATION_FAILED");
});

test("diff: profile fields, package add/remove/change (price compared as a number), photo order and cover; no change -> empty", () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const pkg = (id: string, price = 100) => ({ id, name: "n", description: null, price, sessionCount: 1, sessionMode: "ONLINE" as const, sessionDurationMinutes: 60, validityDays: null, isActive: true });
  const before = { ...payload(), packages: [pkg(id1), pkg(id2)], photoIds: ["p1", "p2"], coverPhotoId: "p1" } as any;
  assert.deepEqual(diffPayloads(before, JSON.parse(JSON.stringify(before))), []);
  const after = JSON.parse(JSON.stringify(before));
  after.profile.professionalBio = "new";
  after.packages = [pkg(id1, 150), { name: "brand new", price: 5, sessionCount: 1, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true }];
  after.photoIds = ["p2", "p1"];
  after.coverPhotoId = "p2";
  const paths = diffPayloads(before, after).map((c) => c.path).sort();
  assert.deepEqual(paths, ["coverPhotoId", "packages[+]", `packages[${id1}].price`, `packages[${id2}]`, "photoIds", "profile.professionalBio"].sort());
  // a package flagged archive counts as removed
  const archived = JSON.parse(JSON.stringify(before));
  archived.packages[1].archive = true;
  assert.deepEqual(diffPayloads(before, archived).map((c) => c.path), [`packages[${id2}]`]);
});

test("magic bytes: jpeg / png / webp only", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectImageType(Buffer.from("RIFF\0\0\0\0WEBP", "binary")), "image/webp");
  assert.equal(detectImageType(Buffer.from("GIF89a")), null);
  assert.equal(detectImageType(Buffer.from("%PDF-1.4")), null, "a PDF is not an allowed photo");
  assert.equal(detectImageType(Buffer.from("<svg xmlns=")), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});
