// UNIT test of the pure merge/compare helpers of scripts/aws/dev-manual-config.mjs. No AWS call is made.
import test from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT, DESIRED, mergeApiCors, mergeBucketCors, mergeEnv, policyDiffers } from "../dev-manual-config.mjs";

const ORIGINS = ["https://gymini.vn", "https://www.gymini.vn"];

test("bucket CORS: adds the two origins, keeps every other rule field and origin, is idempotent", () => {
  const cur = {
    CORSRules: [
      { AllowedHeaders: ["content-type", "x-amz-*"], AllowedMethods: ["GET", "PUT", "POST", "HEAD"], AllowedOrigins: ["http://localhost:5173", "https://d1ub83a48p566t.cloudfront.net"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 300 },
    ],
  };
  const { next, changed } = mergeBucketCors(cur, ORIGINS);
  assert.equal(changed, true);
  assert.deepEqual(next.CORSRules[0].AllowedOrigins, ["http://localhost:5173", "https://d1ub83a48p566t.cloudfront.net", ...ORIGINS]);
  assert.deepEqual(next.CORSRules[0].AllowedMethods, ["GET", "PUT", "POST", "HEAD"]);
  assert.equal(mergeBucketCors(next, ORIGINS).changed, false);
});

test("bucket CORS: no configuration yet -> a rule that allows presigned POST from the web origins", () => {
  const { next, changed } = mergeBucketCors(null, ORIGINS);
  assert.equal(changed, true);
  assert.ok(next.CORSRules[0].AllowedMethods.includes("POST"));
  assert.deepEqual(next.CORSRules[0].AllowedOrigins, ORIGINS);
});

test("api CORS: unions headers and origins, never drops an existing one, leaves methods and max-age alone", () => {
  const cur = { AllowOrigins: ["https://gymini.vn"], AllowHeaders: ["authorization", "content-type"], AllowMethods: ["GET", "*"], MaxAge: 300, AllowCredentials: false };
  const { next, changed } = mergeApiCors(cur, ORIGINS, DESIRED.api.allowHeaders);
  assert.equal(changed, true);
  assert.deepEqual(next.AllowOrigins, ORIGINS);
  assert.deepEqual(next.AllowHeaders, DESIRED.api.allowHeaders);
  assert.deepEqual(next.AllowMethods, ["GET", "*"]);
  assert.equal(next.MaxAge, 300);
  assert.equal(mergeApiCors(next, ORIGINS, DESIRED.api.allowHeaders).changed, false);
});

test("api CORS: the three x-gymini-* headers the web app sends are part of the desired state", () => {
  for (const h of ["x-gymini-client", "x-gymini-listing-flow", "x-gymini-venue-consent"]) assert.ok(DESIRED.api.allowHeaders.includes(h), h);
});

test("lambda env: sets wanted keys on top of the full current map and reports only what changed", () => {
  const cur = { DATABASE_SECRET_ID: "x", TZ: "UTC", KEEP: "1" };
  const { next, changedKeys } = mergeEnv(cur, { TZ: "Asia/Ho_Chi_Minh", REQUIRE_CONTRACT_ESIGN: "false" });
  assert.deepEqual(changedKeys, ["TZ", "REQUIRE_CONTRACT_ESIGN"]);
  assert.deepEqual(next, { DATABASE_SECRET_ID: "x", TZ: "Asia/Ho_Chi_Minh", KEEP: "1", REQUIRE_CONTRACT_ESIGN: "false" });
  assert.deepEqual(mergeEnv(next, { TZ: "Asia/Ho_Chi_Minh" }).changedKeys, []);
  assert.deepEqual(mergeEnv(undefined, { A: "1" }).next, { A: "1" });
});

test("policy compare: statement order does not matter, a missing policy or a different resource is drift", () => {
  const doc = DESIRED.iam[0].document;
  assert.equal(policyDiffers(doc, doc), false);
  assert.equal(policyDiffers({ ...doc, Statement: [...doc.Statement].reverse() }, doc), false);
  assert.equal(policyDiffers(null, doc), true);
  const widened = { ...doc, Statement: doc.Statement.map((s, i) => (i === 0 ? { ...s, Resource: "arn:aws:s3:::any/*" } : s)) };
  assert.equal(policyDiffers(widened, doc), true);
});

test("desired state stays least-privilege and covers every Lambda that must run on Vietnam time", () => {
  assert.equal(ACCOUNT, "191798898985");
  for (const p of DESIRED.iam) {
    for (const s of p.document.Statement) {
      const actions = [].concat(s.Action);
      assert.ok(!actions.some((a) => a === "*" || a === "s3:*" || a === "s3:ListBucket"), `${p.policy}: ${actions}`);
      for (const r of [].concat(s.Resource)) assert.ok(!r.endsWith(":*") && r !== "*" && !/uploads-dev-\d+$/.test(r), `${p.policy}: ${r}`);
    }
  }
  for (const name of ["user", "gym", "payment", "fitness", "auth", "user-jobs", "gym-jobs", "payment-jobs", "fitness-jobs"]) {
    assert.equal(DESIRED.lambdaEnv[name].TZ, "Asia/Ho_Chi_Minh", name);
  }
  assert.equal(DESIRED.lambdaEnv.user.REQUIRE_CONTRACT_ESIGN, "false");
});
