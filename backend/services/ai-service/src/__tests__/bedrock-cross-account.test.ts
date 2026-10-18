/**
 * Cross-account Bedrock credentials (bedrock.client.ts's getCrossAccountCredentials).
 *
 * Only active when BEDROCK_CROSS_ACCOUNT_ROLE_ARN is set, which it is here —
 * set before import since the client reads it once at module load, matching
 * this file's own existing convention for BEDROCK_REGION/BEDROCK_CHAT_MODEL.
 * The STS call goes through `stsDeps.send`, replaced here with a recorder,
 * so the assume/cache/refresh logic is verified with no AWS account.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.BEDROCK_CROSS_ACCOUNT_ROLE_ARN =
  "arn:aws:iam::730323515543:role/GyminiAiServiceBedrockCrossAccount";
process.env.BEDROCK_CROSS_ACCOUNT_EXTERNAL_ID = "test-external-id";

// Static import placed after the env vars above: this file's esbuild/tsx CJS
// transform converts `import` to an in-place `require`, so (as in this
// directory's other bedrock test) the module reads the env vars set just
// above it, not whatever was set before this file ran.
import {
  stsDeps,
  getCrossAccountCredentials,
  resetCrossAccountCredentialsCacheForTests,
} from "../services/bedrock.client";

function fakeCredentials(overrides: Partial<{
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  Expiration: Date;
}> = {}) {
  return {
    $metadata: {},
    Credentials: {
      AccessKeyId: "AKIAFAKE",
      SecretAccessKey: "secret",
      SessionToken: "token",
      Expiration: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    },
  };
}

test("assumes the role and passes RoleArn + ExternalId", async () => {
  resetCrossAccountCredentialsCacheForTests();
  const calls: unknown[] = [];
  stsDeps.send = (command: any) => {
    calls.push(command.input);
    return Promise.resolve(fakeCredentials());
  };

  const creds = await getCrossAccountCredentials();

  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0] as any).RoleArn,
    "arn:aws:iam::730323515543:role/GyminiAiServiceBedrockCrossAccount",
  );
  assert.equal((calls[0] as any).ExternalId, "test-external-id");
  assert.equal(creds.accessKeyId, "AKIAFAKE");
});

test("caches credentials across calls instead of re-assuming every time", async () => {
  resetCrossAccountCredentialsCacheForTests();
  let sendCount = 0;
  stsDeps.send = () => {
    sendCount += 1;
    return Promise.resolve(fakeCredentials());
  };

  await getCrossAccountCredentials();
  await getCrossAccountCredentials();
  await getCrossAccountCredentials();

  assert.equal(sendCount, 1, "a fresh, far-from-expiry session must not re-assume");
});

test("re-assumes once the cached session is within the refresh skew of expiring", async () => {
  resetCrossAccountCredentialsCacheForTests();
  let sendCount = 0;
  stsDeps.send = () => {
    sendCount += 1;
    // Expires in 1 minute — inside the 5-minute refresh skew.
    return Promise.resolve(fakeCredentials({ Expiration: new Date(Date.now() + 60 * 1000) }));
  };

  await getCrossAccountCredentials();
  await getCrossAccountCredentials();

  assert.equal(sendCount, 2, "a near-expiry cached session must be refreshed, not reused");
});

test("throws a clear error when AssumeRole returns incomplete credentials", async () => {
  resetCrossAccountCredentialsCacheForTests();
  stsDeps.send = () => Promise.resolve({ $metadata: {}, Credentials: undefined });

  await assert.rejects(
    () => getCrossAccountCredentials(),
    /incomplete credentials/,
  );
});
