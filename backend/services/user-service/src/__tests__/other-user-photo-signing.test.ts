import test from "node:test";
import assert from "node:assert/strict";

/**
 * Other users' profile photos in list/detail responses (contract parties, session counterparties, PT applicant,
 * agent PT candidates, PT discovery). BACKEND UNIT (DB-free): SigV4 presigning is a local computation (no network),
 * so the REAL signer runs against fake-but-well-formed credentials.
 */

const BUCKET = "fitness-assistant-uploads-test";
const ENV_KEYS = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "USER_UPLOAD_BUCKET"];

async function withAws(fn: () => Promise<void>, opts: { bucket?: boolean } = {}) {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  process.env.AWS_REGION = "ap-southeast-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIAFAKEFAKEFAKEFAKE";
  process.env.AWS_SECRET_ACCESS_KEY = "fakefakefakefakefakefakefakefakefakefake";
  if (opts.bucket === false) delete process.env.USER_UPLOAD_BUCKET;
  else process.env.USER_UPLOAD_BUCKET = BUCKET;
  try {
    await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("toSignedOtherUserPhotoUrl: s3://profile-photos/... -> https signed URL", async () => {
  await withAws(async () => {
    const { toSignedOtherUserPhotoUrl } = require("../services/s3-upload.service");
    const url = await toSignedOtherUserPhotoUrl("s3://profile-photos/user-b/a.jpg");
    assert.ok(url.startsWith(`https://${BUCKET}.s3.ap-southeast-1.amazonaws.com/profile-photos/user-b/a.jpg?`), url);
    assert.ok(url.includes("X-Amz-Signature="));
  });
});

test("toSignedOtherUserPhotoUrl: legacy /uploads path, http(s) URL, null and empty pass through unchanged", async () => {
  const { toSignedOtherUserPhotoUrl } = require("../services/s3-upload.service");
  assert.equal(await toSignedOtherUserPhotoUrl("/uploads/profile-photos/x.jpg"), "/uploads/profile-photos/x.jpg");
  assert.equal(await toSignedOtherUserPhotoUrl("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
  assert.equal(await toSignedOtherUserPhotoUrl(null), null);
  assert.equal(await toSignedOtherUserPhotoUrl(undefined), null);
  assert.equal(await toSignedOtherUserPhotoUrl(""), "");
});

test("toSignedOtherUserPhotoUrl: an s3 key outside profile-photos/ (or malformed) is NEVER signed and NEVER echoed (null)", async () => {
  await withAws(async () => {
    const { toSignedOtherUserPhotoUrl } = require("../services/s3-upload.service");
    assert.equal(await toSignedOtherUserPhotoUrl("s3://pt-applications/u/id-card.jpg"), null);
    assert.equal(await toSignedOtherUserPhotoUrl("s3://contracts/c1/contract.pdf"), null);
    assert.equal(await toSignedOtherUserPhotoUrl("s3://profile-photos-evil/u/a.jpg"), null);
    assert.equal(await toSignedOtherUserPhotoUrl("s3://profile-photos/../contracts/c1/contract.pdf"), null);
  });
});

test("toSignedOtherUserPhotoUrl: a signing failure (bucket not configured) yields null instead of failing the whole list", async () => {
  await withAws(
    async () => {
      const { toSignedOtherUserPhotoUrl } = require("../services/s3-upload.service");
      assert.equal(await toSignedOtherUserPhotoUrl("s3://profile-photos/u/a.jpg"), null);
    },
    { bucket: false },
  );
});

test("signOtherUserPhotosInMap: a list/map response keeps its shape; only photoUrl changes", async () => {
  await withAws(async () => {
    const { signOtherUserPhotosInMap, withSignedOtherUserPhoto } = require("../services/profile.service");
    const map = new Map<string, any>([
      ["a", { userId: "a", firstName: "A", photoUrl: "s3://profile-photos/a/1.jpg" }],
      ["b", { userId: "b", firstName: "B", photoUrl: "/uploads/profile-photos/legacy.jpg" }],
      ["c", { userId: "c", firstName: "C", photoUrl: "s3://contracts/c/secret.pdf" }],
      ["d", { userId: "d", firstName: "D", photoUrl: null }],
      ["e", { userId: "e", firstName: null, lastName: null, email: null }],
    ]);
    await signOtherUserPhotosInMap(map);
    assert.match(map.get("a").photoUrl, /^https:\/\/.+X-Amz-Signature=/);
    assert.equal(map.get("a").firstName, "A");
    assert.equal(map.get("b").photoUrl, "/uploads/profile-photos/legacy.jpg");
    assert.equal(map.get("c").photoUrl, null);
    assert.equal(map.get("d").photoUrl, null);
    assert.deepEqual(map.get("e"), { userId: "e", firstName: null, lastName: null, email: null });
    assert.equal(await withSignedOtherUserPhoto(null), null);

    const src = { userId: "x", photoUrl: "s3://profile-photos/x/1.jpg" };
    const out = await withSignedOtherUserPhoto(src);
    assert.equal(src.photoUrl, "s3://profile-photos/x/1.jpg", "input must not be mutated");
    assert.match(out.photoUrl, /^https:\/\//);
  });
});
