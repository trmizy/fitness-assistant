// Run: node --test scripts/aws/lib/cloudfront-chat-origin.test.cjs
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { patchChatOrigin } = require("./cloudfront-chat-origin.cjs");

const OLD = "dev-chat-alb-306737085.ap-southeast-1.elb.amazonaws.com", NEW = "dev-chat-alb-1427686510.ap-southeast-1.elb.amazonaws.com";
const make = () => ({ ETag: "E1", DistributionConfig: { Comment: "gymini", Origins: { Quantity: 3, Items: [
  { Id: "chat-alb-origin", DomainName: OLD, CustomOriginConfig: { HTTPPort: 80, OriginProtocolPolicy: "http-only" } },
  { Id: "ai-stream-origin", DomainName: "x.lambda-url.ap-southeast-1.on.aws" },
  { Id: "frontend-s3-origin", DomainName: "bucket.s3.ap-southeast-1.amazonaws.com" }] }, CacheBehaviors: { Quantity: 1, Items: [{ PathPattern: "/socket.io/*", TargetOriginId: "chat-alb-origin" }] } } });

test("changes only the chat origin's DomainName; every other field and origin is untouched", () => {
  const input = make(), expected = make(); expected.DistributionConfig.Origins.Items[0].DomainName = NEW;
  const r = patchChatOrigin(input, NEW);
  assert.equal(r.changed, true); assert.equal(r.from, OLD); assert.equal(r.to, NEW);
  assert.deepEqual(r.config, expected.DistributionConfig);
});
test("idempotent: already pointing at the current ALB -> changed:false (nothing to write)", () => {
  const r = patchChatOrigin(make(), OLD); assert.equal(r.changed, false);
});
test("arrays keep their shape (single-item CacheBehaviors stays an array)", () => {
  const r = patchChatOrigin(make(), NEW); assert.ok(Array.isArray(r.config.CacheBehaviors.Items)); assert.equal(r.config.CacheBehaviors.Items.length, 1);
});
test("refuses a missing or duplicated origin (exit code 3) and a non-ELB hostname (exit code 2)", () => {
  const none = make(); none.DistributionConfig.Origins.Items.shift();
  assert.throws(() => patchChatOrigin(none, NEW), (e) => e.exitCode === 3);
  const dup = make(); dup.DistributionConfig.Origins.Items.push({ ...dup.DistributionConfig.Origins.Items[0] });
  assert.throws(() => patchChatOrigin(dup, NEW), (e) => e.exitCode === 3);
  for (const bad of ["evil.example.com", "", undefined, "http://x.elb.amazonaws.com", "a.b.elb.amazonaws.com.evil.com"]) assert.throws(() => patchChatOrigin(make(), bad), (e) => e.exitCode === 2);
});
