import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPtRequestResumePath, parsePtRequestResume, sanitizeReturnTo } from "../paymentReturn";

const BS = String.fromCharCode(92);

describe("sanitizeReturnTo", () => {
  it("accepts in-app client paths with query", () => {
    assert.equal(sanitizeReturnTo("/client/services?ptId=a&packageId=b&resume=request"), "/client/services?ptId=a&packageId=b&resume=request");
  });
  it("rejects open-redirect shapes", () => {
    for (const bad of [
      "https://evil.com", "//evil.com", "/"+BS+"evil.com", "/client/.."+BS+"evil", "javascript:alert(1)", "evil", "", "/pt/x", "/login",
      "/client/a\nb", null, undefined, 5, "/" + "a".repeat(600),
    ]) assert.equal(sanitizeReturnTo(bad as never), null);
  });
});

describe("pt request resume path", () => {
  it("round-trips ptId / packageId / gymId and passes the sanitiser", () => {
    const p = buildPtRequestResumePath({ ptId: "pt 1", packageId: "pk&2", gymId: "g3" });
    assert.equal(sanitizeReturnTo(p), p);
    const q = new URLSearchParams(p.split("?")[1]);
    assert.deepEqual(parsePtRequestResume(q), { ptId: "pt 1", packageId: "pk&2", gymId: "g3" });
  });
  it("gym is optional, and an incomplete link is ignored", () => {
    assert.equal(parsePtRequestResume(new URLSearchParams("resume=request&ptId=a&packageId=b"))?.gymId, null);
    assert.equal(parsePtRequestResume(new URLSearchParams("resume=request&ptId=a")), null);
    assert.equal(parsePtRequestResume(new URLSearchParams("ptId=a&packageId=b")), null);
  });
});
