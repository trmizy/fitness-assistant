import test from "node:test";
import assert from "node:assert/strict";

/**
 * TASK 7/12 — profile photo S3 presigned-upload flow (the AWS-safe alternative to the legacy
 * local-disk `POST /profile/me/photo`). No real AWS call: SigV4 presigning (`getSignedUrl`) is
 * a pure local computation — it never hits the network, so this exercises the REAL function
 * against fake-but-well-formed credentials rather than mocking anything. Covers the two things
 * that actually matter for security here — the client can never pick an arbitrary S3 key
 * (prefix is server-controlled, namespaced by the caller's own userId), and a missing bucket
 * config fails the one request cleanly rather than crashing anything.
 */

function withFakeAwsCreds(fn: () => void | Promise<void>) {
  const keys = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "USER_UPLOAD_BUCKET"];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.AWS_REGION = "ap-southeast-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIAFAKEFAKEFAKEFAKE";
  process.env.AWS_SECRET_ACCESS_KEY = "fakefakefakefakefakefakefakefakefakefake";
  process.env.USER_UPLOAD_BUCKET = "fitness-assistant-uploads-dev-191798898985";
  return Promise.resolve(fn()).finally(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

test("createProfilePhotoUploadUrl mints a key scoped to profile-photos/{userId}/, real SigV4 presign, no network call, no hard-coded bucket/creds", async () => {
  await withFakeAwsCreds(async () => {
    delete require.cache[require.resolve("../services/s3-upload.service")];
    const { createProfilePhotoUploadUrl } = require("../services/s3-upload.service");

    const target = await createProfilePhotoUploadUrl("user-123", "image/png");
    assert.ok(target.key.startsWith("profile-photos/user-123/"), `key should be scoped: ${target.key}`);
    assert.ok(target.key.endsWith(".png"));
    assert.ok(
      target.uploadUrl.startsWith("https://fitness-assistant-uploads-dev-191798898985.s3.ap-southeast-1.amazonaws.com/"),
      `uploadUrl should target the configured bucket: ${target.uploadUrl}`,
    );
    assert.ok(target.uploadUrl.includes("X-Amz-Signature="), "must be a real signed URL, not a stub");
    assert.equal(target.photoUrl, `s3://${target.key}`);
    assert.ok(target.previewUrl.includes("X-Amz-Signature="), "previewUrl must be a signed GET URL");
    assert.strictEqual(target.expiresInSeconds, 300);
  });
});

test("createProfilePhotoUploadUrl rejects a content type outside the allowed image set", async () => {
  await withFakeAwsCreds(async () => {
    delete require.cache[require.resolve("../services/s3-upload.service")];
    const { createProfilePhotoUploadUrl } = require("../services/s3-upload.service");
    await assert.rejects(
      createProfilePhotoUploadUrl("user-123", "application/x-executable"),
      (err: any) => err.status === 400,
    );
  });
});

test("createProfilePhotoUploadUrl fails cleanly (500, not a crash) when USER_UPLOAD_BUCKET is unset", async () => {
  await withFakeAwsCreds(async () => {
    delete process.env.USER_UPLOAD_BUCKET;
    delete require.cache[require.resolve("../services/s3-upload.service")];
    const { createProfilePhotoUploadUrl } = require("../services/s3-upload.service");
    await assert.rejects(
      createProfilePhotoUploadUrl("user-123", "image/png"),
      (err: any) => err.status === 500,
    );
  });
});

test("isOwnProfilePhotoKey: accepts a key genuinely scoped to the caller's own userId", () => {
  const { isOwnProfilePhotoKey } = require("../services/s3-upload.service");
  assert.strictEqual(isOwnProfilePhotoKey("user-123", "profile-photos/user-123/abc.png"), true);
});

test("isOwnProfilePhotoKey: rejects another user's key — cannot confirm someone else's upload as your own", () => {
  const { isOwnProfilePhotoKey } = require("../services/s3-upload.service");
  assert.strictEqual(isOwnProfilePhotoKey("user-123", "profile-photos/some-other-user/abc.png"), false);
});

test("isOwnProfilePhotoKey: rejects a path-traversal attempt even if the prefix matches", () => {
  const { isOwnProfilePhotoKey } = require("../services/s3-upload.service");
  assert.strictEqual(isOwnProfilePhotoKey("user-123", "profile-photos/user-123/../other-user/abc.png"), false);
});

test("isOwnProfilePhotoKey: rejects an arbitrary key outside the profile-photos/ prefix entirely", () => {
  const { isOwnProfilePhotoKey } = require("../services/s3-upload.service");
  assert.strictEqual(isOwnProfilePhotoKey("user-123", "some-other-bucket-area/user-123/abc.png"), false);
});
