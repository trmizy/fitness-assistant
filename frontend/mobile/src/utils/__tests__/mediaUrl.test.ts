import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveMediaUri } from "../mediaUrl";

const BASE = "https://api.example.test";

describe("resolveMediaUri", () => {
  it("puts a gateway path behind the server address in use", () => {
    assert.equal(
      resolveMediaUri("/uploads/profile-photos/e300133c", BASE),
      "https://api.example.test/uploads/profile-photos/e300133c",
    );
    assert.equal(resolveMediaUri("uploads/x.png", `${BASE}/`), "https://api.example.test/uploads/x.png");
  });

  it("leaves an already loadable reference alone", () => {
    for (const uri of ["https://cdn.example.test/a.jpg?X-Amz-Signature=1", "http://10.0.2.2:9000/b.png", "file:///data/c.png", "content://media/1", "data:image/png;base64,AAAA"]) {
      assert.equal(resolveMediaUri(uri, BASE), uri);
    }
  });

  it("has nothing to resolve for a missing or blank reference", () => {
    assert.equal(resolveMediaUri(null, BASE), null);
    assert.equal(resolveMediaUri(undefined, BASE), null);
    assert.equal(resolveMediaUri("   ", BASE), null);
  });
});
