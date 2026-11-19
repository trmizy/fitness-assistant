/**
 * Android App Links cho liên kết chia sẻ gym (https://gymini.vn/gyms/<id>).
 * Chạy: npx tsx --test src/features/__tests__/gymAppLink.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { gymAppLinkRoute, gymIdFromAppLink } from "../services/gymAppLink";
import { publicGymUrl } from "../services/gymHours";
import { redirectSystemPath } from "../../../app/+native-intent";

const ID = "7d5e3f0a-1b2c-4d3e-8f90-123456789abc";

describe("gymIdFromAppLink", () => {
  it("đọc id từ link https của cả hai host (kể cả hoa/thường, query, hash, dấu / cuối)", () => {
    assert.equal(gymIdFromAppLink(`https://gymini.vn/gyms/${ID}`), ID);
    assert.equal(gymIdFromAppLink(`https://www.gymini.vn/gyms/${ID}`), ID);
    assert.equal(gymIdFromAppLink(`https://GYMINI.vn/gyms/${ID}/`), ID);
    assert.equal(gymIdFromAppLink(`https://gymini.vn/gyms/${ID}?utm=share#top`), ID);
    assert.equal(gymIdFromAppLink(`  https://gymini.vn/gyms/${ID}  `), ID);
  });

  it("đọc được đường dẫn trần /gyms/<id>", () => {
    assert.equal(gymIdFromAppLink(`/gyms/${ID}`), ID);
  });

  it("khớp đúng link do nút chia sẻ tạo ra", () => {
    assert.equal(gymIdFromAppLink(publicGymUrl(ID)), ID);
  });

  it("từ chối host lạ, http thường, scheme khác, protocol-relative", () => {
    assert.equal(gymIdFromAppLink(`https://evil.com/gyms/${ID}`), null);
    assert.equal(gymIdFromAppLink(`https://gymini.vn.evil.com/gyms/${ID}`), null);
    assert.equal(gymIdFromAppLink(`https://evilgymini.vn/gyms/${ID}`), null);
    assert.equal(gymIdFromAppLink(`http://gymini.vn/gyms/${ID}`), null);
    assert.equal(gymIdFromAppLink(`fitnessassistant://gyms/${ID}`), null);
    assert.equal(gymIdFromAppLink(`//gymini.vn/gyms/${ID}`), null);
    assert.equal(gymIdFromAppLink(`https://user@gymini.vn/gyms/${ID}`), null);
  });

  it("từ chối đường dẫn không phải chi tiết gym hoặc id lạ", () => {
    assert.equal(gymIdFromAppLink("https://gymini.vn/"), null);
    assert.equal(gymIdFromAppLink("https://gymini.vn"), null);
    assert.equal(gymIdFromAppLink("https://gymini.vn/gyms"), null);
    assert.equal(gymIdFromAppLink("https://gymini.vn/gyms/"), null);
    assert.equal(gymIdFromAppLink(`https://gymini.vn/gyms/${ID}/edit`), null);
    assert.equal(gymIdFromAppLink(`https://gymini.vn/pts/${ID}`), null);
    assert.equal(gymIdFromAppLink("https://gymini.vn/gyms/../admin"), null);
    assert.equal(gymIdFromAppLink("https://gymini.vn/gyms/%2E%2E"), null);
    assert.equal(gymIdFromAppLink("https://gymini.vn/gyms/a%2Fb"), null);
    assert.equal(gymIdFromAppLink("https://gymini.vn/gyms/%E0%A4%A"), null);
    assert.equal(gymIdFromAppLink("/client/dashboard"), null);
    assert.equal(gymIdFromAppLink("gyms/abc"), null);
    assert.equal(gymIdFromAppLink(""), null);
    assert.equal(gymIdFromAppLink(null), null);
    assert.equal(gymIdFromAppLink(undefined), null);
  });
});

describe("gymAppLinkRoute", () => {
  it("trỏ tới chi tiết gym của khách", () => {
    assert.equal(gymAppLinkRoute(`https://gymini.vn/gyms/${ID}`), `/client/services/gyms/${ID}`);
    assert.equal(gymAppLinkRoute("https://gymini.vn/pricing"), null);
  });
});

describe("redirectSystemPath (+native-intent)", () => {
  it("link gym https -> route chi tiết gym, cả lúc mở nguội lẫn nóng", () => {
    for (const initial of [true, false]) {
      assert.equal(
        redirectSystemPath({ path: `https://gymini.vn/gyms/${ID}`, initial }),
        `/client/services/gyms/${ID}`,
      );
    }
  });

  it("không đụng tới link khác: thanh toán vẫn qua resultHref, còn lại đi nguyên", () => {
    assert.equal(redirectSystemPath({ path: "fitnessassistant://client/dashboard", initial: true }), "fitnessassistant://client/dashboard");
    assert.equal(redirectSystemPath({ path: "https://gymini.vn/pricing", initial: false }), "https://gymini.vn/pricing");
    assert.match(
      redirectSystemPath({ path: "fitnessassistant://client/payments/result?txnId=abc&status=success", initial: false }),
      /^\/client\/payments\/result/,
    );
  });
});
