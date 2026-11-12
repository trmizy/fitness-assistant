import test from "node:test";
import assert from "node:assert/strict";
import { scaledCounts } from "../lib/scale/config.mjs";
import { buildScaleUniverse } from "../lib/scale/data-generators.mjs";
import {
  allocateMediaAssignments,
  loadUsableMasterPools,
  syncMediaToMinio,
  verifyMinioMediaObjects,
} from "../lib/scale/media.mjs";
import { rngFrom } from "../lib/scale/rng.mjs";
import { scaleDid as didFn } from "../lib/scale/config.mjs";

test("allocateMediaAssignments enforces <=40 reuse cap, strict gender match, C7 facilities, and no DRAFT PUBLISHED", () => {
  const counts = scaledCounts(1);
  const u = buildScaleUniverse({ counts, masterPools: loadUsableMasterPools() });
  const { ptPhotos, gymPhotos, maxPtReuse, maxGymReuse } = u.mediaPlan;

  assert.ok(maxPtReuse <= 40, `PT photo max reuse ${maxPtReuse} > 40`);
  assert.ok(maxGymReuse <= 40, `Gym photo max reuse ${maxGymReuse} > 40`);

  const ptById = new Map(u.pts.map((p) => [p.userId, p]));
  const masterGender = new Map();
  const masterPools = loadUsableMasterPools();
  for (const m of masterPools.ptMale) masterGender.set(m.id, "MALE");
  for (const m of masterPools.ptFemale) masterGender.set(m.id, "FEMALE");

  // Production-like coverage: EVERY PT with a published listing has >= 1 PUBLISHED photo and an avatar url.
  const photoCountByPt = new Map();
  for (const ph of ptPhotos) photoCountByPt.set(ph.ptUserId, (photoCountByPt.get(ph.ptUserId) ?? 0) + 1);
  const listed = u.pts.filter((p) => p.hasPublishedListing);
  assert.ok(listed.length > 0);
  assert.deepEqual(listed.filter((p) => !photoCountByPt.get(p.userId)).map((p) => p.userId), [], "PT with published listing but 0 photos");
  assert.deepEqual(u.pts.filter((p) => p.isPublic && !p.photoUrl).map((p) => p.userId), [], "public PT without avatar");
  assert.ok(ptPhotos.every((p) => p.status === "PUBLISHED"));

  const ptHashes = new Map();
  const ptCovers = new Map();
  for (const ph of ptPhotos) {
    const pt = ptById.get(ph.ptUserId);
    assert.equal(masterGender.get(ph.masterId), pt.gender, `gender mismatch on PT ${pt.userId}`);
    let set = ptHashes.get(ph.ptUserId);
    if (!set) ptHashes.set(ph.ptUserId, (set = new Set()));
    assert.equal(set.has(ph.contentHash), false, "duplicate photo hash on PT");
    set.add(ph.contentHash);
    if (ph.isCover) ptCovers.set(ph.ptUserId, (ptCovers.get(ph.ptUserId) ?? 0) + 1);
  }
  for (const [uid, hashes] of ptHashes.entries()) {
    assert.ok(hashes.size <= 5);
    assert.equal(ptCovers.get(uid), 1, `PT ${uid} cover count != 1`);
  }

  // Gym C7 matching & DRAFT rule
  const gymById = new Map(u.branches.map((g) => [g.id, g]));
  const masterCat = new Map();
  for (const [cat, items] of masterPools.gymByCategory.entries()) {
    for (const m of items) masterCat.set(m.id, cat);
  }
  for (const ph of gymPhotos) {
    const g = gymById.get(ph.gymId);
    const cat = masterCat.get(ph.masterId);
    if (cat === "pool") assert.ok(g.facilities.includes("SWIMMING_POOL"), "pool photo on gym without SWIMMING_POOL");
    if (cat === "yoga-studio") assert.ok(g.facilities.includes("YOGA_STUDIO"), "yoga photo on gym without YOGA_STUDIO");
    if (cat === "boxing") assert.ok(g.facilities.includes("FUNCTIONAL_TRAINING_AREA"), "boxing photo on gym without functional area");
    if (g.status === "DRAFT") assert.notEqual(ph.status, "PUBLISHED");
  }
  const coverGyms = new Set(gymPhotos.filter((p) => p.status === "PUBLISHED" && p.isCover).map((p) => p.gymId));
  const publicGyms = u.branches.filter((g) => g.status === "APPROVED" || g.status === "SUSPENDED");
  assert.ok(publicGyms.length > 0);
  assert.deepEqual(publicGyms.filter((g) => !coverGyms.has(g.id)).map((g) => g.id), [], "APPROVED/SUSPENDED gym without a PUBLISHED cover");
});

test("syncMediaToMinio (mock S3 adapter) uploads each master once, server-side CopyObjects all targets, supports resume, and passes verify", async () => {
  const counts = scaledCounts(0.01);
  const pools = loadUsableMasterPools();
  const pts = Array.from({ length: 6 }, (_, i) => ({
    userId: didFn("mock-s3", "pt", i),
    gender: i % 2 === 0 ? "MALE" : "FEMALE",
    hasPublishedListing: true,
    specialties: i === 0 ? ["Boxing & MMA"] : ["Tăng cơ"],
    createdAt: new Date(),
  }));
  const gyms = Array.from({ length: 4 }, (_, i) => ({
    id: didFn("mock-s3", "gym", i),
    ownerId: didFn("mock-s3", "owner", i),
    status: i === 3 ? "DRAFT" : "APPROVED",
    facilities: i === 0 ? ["SWIMMING_POOL", "WIFI"] : ["FREE_WEIGHTS"],
    createdAt: new Date(),
  }));

  const mediaPlan = allocateMediaAssignments({
    pts,
    gyms,
    pools,
    rng: rngFrom("mock-media-test"),
    didFn: (...p) => didFn("mock-s3", ...p),
  });

  // In-memory S3 mock
  const buckets = new Map([["gymini-user-media", new Map()], ["gymini-partner-private", new Map()]]);
  let puts = 0;
  let copies = 0;
  class PutObjectCommand { constructor(input) { this.type = "put"; this.input = input; } }
  class CopyObjectCommand { constructor(input) { this.type = "copy"; this.input = input; } }
  class ListObjectsV2Command { constructor(input) { this.type = "list"; this.input = input; } }

  const mockClient = {
    async send(cmd) {
      if (cmd.type === "put") {
        puts++;
        buckets.get(cmd.input.Bucket).set(cmd.input.Key, cmd.input.Body);
        return {};
      }
      if (cmd.type === "copy") {
        copies++;
        const [srcBucket, ...rest] = cmd.input.CopySource.split("/");
        const srcKey = rest.join("/");
        const body = buckets.get(srcBucket)?.get(srcKey);
        assert.ok(body, `missing CopySource ${cmd.input.CopySource}`);
        buckets.get(cmd.input.Bucket).set(cmd.input.Key, body);
        return {};
      }
      if (cmd.type === "list") {
        const b = buckets.get(cmd.input.Bucket);
        const contents = [...b.keys()]
          .filter((k) => k.startsWith(cmd.input.Prefix || ""))
          .map((Key) => ({ Key }));
        return { Contents: contents, IsTruncated: false };
      }
      throw new Error(`unexpected cmd ${cmd.type}`);
    },
  };

  const s3 = { ptClient: mockClient, gymClient: mockClient, ptBucket: "gymini-user-media", gymBucket: "gymini-partner-private" };
  const commands = { PutObjectCommand, CopyObjectCommand, ListObjectsV2Command };

  const res1 = await syncMediaToMinio({ ptPhotos: mediaPlan.ptPhotos, gymPhotos: mediaPlan.gymPhotos, s3, commands, log: () => {} });
  assert.equal(res1.uploadedMasters, mediaPlan.ptMasterIdsUsed.length + mediaPlan.gymMasterIdsUsed.length);
  assert.equal(puts, res1.uploadedMasters);
  assert.equal(copies, mediaPlan.ptPhotos.length + mediaPlan.gymPhotos.length);

  const ver = await verifyMinioMediaObjects({
    ptStorageKeys: mediaPlan.ptPhotos.map((p) => p.storageKey),
    gymS3Keys: mediaPlan.gymPhotos.map((g) => g.s3Key),
    s3,
    ListObjectsV2Command,
  });
  assert.equal(ver.missingPtCount, 0);
  assert.equal(ver.missingGymCount, 0);

  // Resume run should do 0 new puts and 0 new copies
  puts = 0;
  copies = 0;
  const res2 = await syncMediaToMinio({ ptPhotos: mediaPlan.ptPhotos, gymPhotos: mediaPlan.gymPhotos, s3, commands, resume: true, log: () => {} });
  assert.equal(puts, 0);
  assert.equal(copies, 0);
  assert.equal(res2.skipped, mediaPlan.ptPhotos.length + mediaPlan.gymPhotos.length);
});
