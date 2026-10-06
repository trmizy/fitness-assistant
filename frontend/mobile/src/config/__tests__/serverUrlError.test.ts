/**
 * The server address typed in "Cấu hình máy chủ" is checked before it is saved. Regression: a stray
 * key in front of a pasted link was stored as "https://lhttps://…" and the app then failed every
 * request with nothing pointing at the address (real phone, 6/10).
 *
 * Runs with: npx tsx --test src/config/__tests__/serverUrlError.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { serverUrlError } from "../serverUrl";

describe("serverUrlError", () => {
  it("accepts tunnels, LAN addresses, ports, and an empty value (back to the default)", () => {
    assert.equal(serverUrlError("https://openings-reaches-pencil-openings.trycloudflare.com", false), null);
    assert.equal(serverUrlError("  https://api.gymini.vn/  ", false), null);
    assert.equal(serverUrlError("http://192.168.40.69:3000", true), null);
    assert.equal(serverUrlError("localhost:3000", true), null);
    assert.equal(serverUrlError("", false), null);
  });

  it("rejects an address with a stray character or a doubled scheme", () => {
    for (const bad of ["lhttps://stylus-internship.trycloudflare.com", "https://https://a.b.com", "https://a b.com", "https://", "xhttps://openings.trycloudflare.com"]) {
      assert.match(serverUrlError(bad, true) ?? "", /không hợp lệ/, bad);
    }
  });

  it("a release build refuses http:// — its network config blocks cleartext", () => {
    assert.equal(serverUrlError("http://192.168.40.69:3000", false), "Bản phát hành chỉ kết nối được địa chỉ https://");
    assert.equal(serverUrlError("192.168.40.69:3000", false), "Bản phát hành chỉ kết nối được địa chỉ https://");
  });
});
