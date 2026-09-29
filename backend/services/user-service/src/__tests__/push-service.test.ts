/**
 * Mobile Phase 14.2 — phone push via FCM HTTP v1 (push.service.ts) and the device routes'
 * token check. Pure: no DB, no network.
 *
 * Run: npx tsx --test src/__tests__/push-service.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ANDROID_CHANNEL_ID,
  buildMessage,
  isDeadToken,
  loadServiceAccount,
  signAssertion,
  type ServiceAccount,
} from "../services/push.service";
import { isPlausibleToken } from "../controllers/notification.controller";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sa: ServiceAccount = {
  project_id: "gymini-test",
  client_email: "push@gymini-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf-8"));

describe("signAssertion", () => {
  it("is an RS256 JWT Google can verify with the account's public key", () => {
    const jwt = signAssertion(sa, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
    assert.deepEqual(decode(claims), {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const ok = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    assert.equal(ok, true);
  });
});

describe("buildMessage", () => {
  it("carries the text as the body and routing data as strings only", () => {
    const msg = buildMessage("tok", {
      id: "n1",
      userId: "u1",
      text: "PT đã xác nhận buổi tập",
      eventType: "SESSION_CONFIRMED",
      entityType: "SESSION",
      entityId: "s1",
      link: null,
    });
    assert.equal(msg.message.token, "tok");
    assert.deepEqual(msg.message.notification, { title: "Gymini", body: "PT đã xác nhận buổi tập" });
    assert.equal(msg.message.android.notification.channel_id, ANDROID_CHANNEL_ID);
    for (const value of Object.values(msg.message.data)) assert.equal(typeof value, "string");
    assert.equal(msg.message.data.userId, "u1", "the app checks the push is for whoever is signed in");
    assert.equal(msg.message.data.link, "");
  });
});

describe("isDeadToken", () => {
  it("only a gone token is forgotten — a malformed message never unsubscribes phones", () => {
    assert.equal(isDeadToken(404, null), true);
    assert.equal(isDeadToken(400, { error: { details: [{ errorCode: "UNREGISTERED" }] } }), true);
    assert.equal(isDeadToken(400, { error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } }), false);
    assert.equal(isDeadToken(500, null), false);
    assert.equal(isDeadToken(429, { error: { details: [{ errorCode: "QUOTA_EXCEEDED" }] } }), false);
  });
});

describe("loadServiceAccount", () => {
  const key = { type: "service_account", ...sa };

  it("reads the key file from the credentials directory, skipping other JSON", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "push-"));
    writeFileSync(path.join(dir, "a-not-a-key.json"), JSON.stringify({ hello: "world" }));
    writeFileSync(path.join(dir, "gymini-firebase-adminsdk-x.json"), JSON.stringify(key));
    assert.equal(loadServiceAccount({ FIREBASE_CREDENTIALS_DIR: dir })?.project_id, "gymini-test");
  });

  it("prefers inline JSON, and is simply off when nothing is configured", () => {
    assert.equal(
      loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(key) })?.client_email,
      sa.client_email,
    );
    assert.equal(loadServiceAccount({ FIREBASE_CREDENTIALS_DIR: path.join(tmpdir(), "nope-404") }), null);
  });
});

describe("isPlausibleToken", () => {
  it("accepts an FCM-shaped token, rejects garbage", () => {
    assert.equal(isPlausibleToken("dQw4w9WgXcQ:APA91bH" + "x".repeat(140)), true);
    assert.equal(isPlausibleToken("short"), false);
    assert.equal(isPlausibleToken("has spaces in it but is long enough"), false);
    assert.equal(isPlausibleToken(42), false);
    assert.equal(isPlausibleToken(undefined), false);
  });
});
