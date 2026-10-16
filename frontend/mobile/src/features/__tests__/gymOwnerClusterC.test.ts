/**
 * Phase 12 cụm C — thiết lập/nhận tiền (GY-08), quản lý chi nhánh (GY-05), hồ sơ chủ gym (WB-18).
 *
 * Chạy: npx tsx --test src/features/__tests__/gymOwnerClusterC.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ABOUT_MAX,
  EMPTY_BRAND_PROFILE,
  EMPTY_PAYOUT,
  ONBOARDING_STEPS,
  SOCIAL_FIELDS,
  STALE_INVITE_DAYS,
  activeManagers,
  brandProfileError,
  brandProfileFrom,
  brandProfilePayload,
  daysSince,
  inviteIsStale,
  inviteManagerError,
  managerName,
  managerScopeLabel,
  onboardingDone,
  onboardingStepIndex,
  ownedGyms,
  passwordChangeError,
  payoutDirty,
  payoutError,
  payoutFrom,
  pendingManagerInvites,
  phoneError,
  socialUrlError,
  visibleOnboardingSteps,
} from "../gymOwner/gymOwner";

describe("thiết lập lần đầu (GY-08)", () => {
  it("quản lý chi nhánh chỉ có bước liên hệ; chủ sở hữu có đủ bốn", () => {
    assert.equal(visibleOnboardingSteps({ role: "OWNER" }).length, 4);
    assert.equal(visibleOnboardingSteps({ role: "MANAGER" }).length, 1);
    assert.equal(visibleOnboardingSteps(null).length, 1, "chưa biết vai trò thì không bày bước của chủ sở hữu");
    assert.deepEqual(ONBOARDING_STEPS.map((s) => s.key), ["contact", "brand", "payout", "terms"]);
  });

  it("bước đang dở lấy từ currentStep của máy chủ, và bị kẹp trong khoảng hợp lệ", () => {
    // currentStep đếm từ 1 cho bước đặt mật khẩu (đã xong), nên bước nhìn thấy đầu tiên là 2.
    assert.equal(onboardingStepIndex({ role: "OWNER", currentStep: 2 }), 0);
    assert.equal(onboardingStepIndex({ role: "OWNER", currentStep: 4 }), 2, "đang ở bước nhận tiền");
    assert.equal(onboardingStepIndex({ role: "OWNER", currentStep: 5 }), 3);
    assert.equal(onboardingStepIndex({ role: "OWNER", currentStep: 99 }), 3, "không tràn ra ngoài");
    assert.equal(onboardingStepIndex({ role: "OWNER", currentStep: 1 }), 0, "không âm");
    assert.equal(onboardingStepIndex({ role: "MANAGER", currentStep: 5 }), 0, "quản lý chỉ có một bước");
    assert.equal(onboardingStepIndex(null), 0);
  });

  it("chỉ cờ completed của máy chủ mới là 'đã xong'", () => {
    assert.equal(onboardingDone({ completed: true }), true);
    // Chủ gym cũ có thể completed=true mà payout trống — không được tự tính lại thành chưa xong.
    assert.equal(onboardingDone({ completed: true, payout: null }), true);
    assert.equal(onboardingDone({ completed: false }), false);
    assert.equal(onboardingDone(null), false);
  });

  it("số điện thoại: nhận dấu cách/chấm/gạch và tiền tố +, từ chối rác", () => {
    assert.equal(phoneError("0901234567"), null);
    assert.equal(phoneError("+84 90 123 4567"), null);
    assert.ok(phoneError(""));
    assert.ok(phoneError("123"));
    assert.ok(phoneError("gọi tôi nhé"));
  });

  it("tài khoản nhận tiền cần đủ ba ô, và 'đã đổi' so với bản đã lưu", () => {
    assert.ok(payoutError(EMPTY_PAYOUT));
    assert.equal(payoutError({ bankName: "MB", accountNumber: "123", accountHolder: "Jane" }), null);

    const progress = { payout: { bankName: "MB", accountNumber: "123", accountHolder: "Jane" } };
    assert.equal(payoutFrom(progress).accountNumber, "123");
    assert.equal(payoutDirty({ bankName: "MB", accountNumber: "123", accountHolder: "Jane" }, progress), false);
    assert.equal(payoutDirty({ bankName: "MB", accountNumber: "456", accountHolder: "Jane" }, progress), true);
    // Khoảng trắng thừa không phải là một thay đổi.
    assert.equal(payoutDirty({ bankName: " MB ", accountNumber: "123", accountHolder: "Jane " }, progress), false);
    assert.deepEqual(payoutFrom(null), EMPTY_PAYOUT);
  });
});

describe("quản lý chi nhánh (GY-05)", () => {
  const accounts = [
    { id: "a1", role: "MANAGER", status: "ACTIVE", scopedGymIds: ["g1"], identity: { firstName: "Lan", lastName: "Nguyễn", email: "lan@x.vn" } },
    { id: "a2", role: "MANAGER", status: "REVOKED", identity: { email: "cu@x.vn" } },
    { id: "a3", role: "OWNER", status: "ACTIVE", identity: { email: "chu@x.vn" } },
    { noId: true },
  ];

  it("chỉ quản lý đang hoạt động — chủ sở hữu không tự nằm trong danh sách của mình", () => {
    assert.deepEqual(activeManagers(accounts).map((a) => a.id), ["a1"]);
    assert.deepEqual(activeManagers({ data: accounts }).map((a) => a.id), ["a1"]);
    assert.equal(activeManagers(null).length, 0);
  });

  it("chỉ thư mời quản lý còn chờ nhận", () => {
    const invites = [
      { id: "i1", role: "MANAGER", status: "PENDING" },
      { id: "i2", role: "MANAGER", status: "ACCEPTED" },
      { id: "i3", role: "OWNER", status: "PENDING" },
    ];
    assert.deepEqual(pendingManagerInvites(invites).map((i) => i.id), ["i1"]);
  });

  it("tên hiển thị lùi dần về email, không bao giờ để trống", () => {
    assert.equal(managerName(accounts[0] as any), "Lan Nguyễn");
    assert.equal(managerName({ id: "x", identity: { email: "a@b.c" } }), "a@b.c");
    assert.equal(managerName({ id: "x" }), "Người quản lý");
  });

  it("chưa gán chi nhánh phải nói THẲNG là chưa gán", () => {
    const gyms = ownedGyms([{ id: "g1", name: "CN Quận 1" }, { id: "g2", name: "CN Quận 3" }]);
    assert.equal(managerScopeLabel(accounts[0] as any, gyms), "CN Quận 1");
    assert.equal(managerScopeLabel({ id: "x", scopedGymIds: ["g1", "g2"] }, gyms), "CN Quận 1, CN Quận 3");
    // Để trống dễ đọc nhầm thành "quản lý tất cả", trong khi họ không vận hành được gì.
    assert.equal(managerScopeLabel({ id: "x", scopedGymIds: [] }, gyms), "Chưa gán chi nhánh");
    assert.equal(managerScopeLabel({ id: "x" }, gyms), "Chưa gán chi nhánh");
  });

  it("thư mời quá bảy ngày là đáng chú ý", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    assert.equal(daysSince(ago(3), now), 3);
    assert.equal(daysSince(null, now), null);
    assert.equal(daysSince("không phải ngày", now), null);
    assert.equal(inviteIsStale({ id: "i", createdAt: ago(STALE_INVITE_DAYS + 1) }, now), true);
    assert.equal(inviteIsStale({ id: "i", createdAt: ago(1) }, now), false);
    assert.equal(inviteIsStale({ id: "i" }, now), false, "không biết ngày thì không kết luận");
  });

  it("mời cần email hợp lệ VÀ ít nhất một chi nhánh", () => {
    assert.equal(inviteManagerError("lan@x.vn", ["g1"]), null);
    assert.ok(inviteManagerError("", ["g1"]));
    assert.ok(inviteManagerError("không-phải-email", ["g1"]));
    assert.ok(inviteManagerError("lan@x.vn", []), "không gán chi nhánh thì họ chẳng làm được gì");
  });
});

describe("hồ sơ chủ gym (WB-18)", () => {
  it("link mạng xã hội kiểm đúng luật của gym-service: https + đúng tên miền", () => {
    assert.equal(socialUrlError("facebookUrl", ""), null, "để trống = không có trang");
    assert.equal(socialUrlError("facebookUrl", "https://facebook.com/gymini"), null);
    assert.equal(socialUrlError("facebookUrl", "https://www.facebook.com/gymini"), null, "bỏ tiền tố www");
    assert.equal(socialUrlError("youtubeUrl", "https://youtu.be/abc"), null, "youtu.be là tên miền hợp lệ");
    assert.ok(socialUrlError("facebookUrl", "http://facebook.com/gymini"), "http bị từ chối");
    assert.ok(socialUrlError("facebookUrl", "https://instagram.com/gymini"), "dán nhầm mạng");
    assert.ok(socialUrlError("tiktokUrl", "tiktok.com/@gymini"), "thiếu scheme");
    assert.ok(socialUrlError("instagramUrl", "https://instagram.com/" + "x".repeat(400)));
  });

  it("biểu mẫu chặn trước mọi thứ máy chủ sẽ từ chối", () => {
    const ok = { ...EMPTY_BRAND_PROFILE, name: "Gymini" };
    assert.equal(brandProfileError(ok), null);
    assert.ok(brandProfileError({ ...ok, name: "A" }));
    assert.ok(brandProfileError({ ...ok, description: "x".repeat(ABOUT_MAX + 1) }));
    assert.ok(brandProfileError({ ...ok, facebookUrl: "ftp://facebook.com/x" }));
  });

  it("ô nhập mồi bằng tên ĐANG CHỜ duyệt, không phải tên cũ", () => {
    const brand: any = { id: "b1", name: "Tên mới", approvedName: "Tên cũ", pendingName: "Tên mới", description: "mô tả" };
    assert.equal(brandProfileFrom(brand).name, "Tên mới");
    assert.equal(brandProfileFrom({ id: "b2", name: "X" } as any).name, "X");
    assert.equal(brandProfileFrom(null).name, "");
  });

  it("chỉ gửi `name` khi tên THẬT SỰ đổi — nếu không sẽ đẻ ra yêu cầu đổi tên vô nghĩa", () => {
    const brand: any = { id: "b1", name: "Gymini", approvedName: "Gymini", facebookUrl: null };
    const same = brandProfileFrom(brand);

    const justSocial = brandProfilePayload({ ...same, facebookUrl: "https://facebook.com/gymini" }, brand);
    assert.ok(!("name" in justSocial), "lưu mỗi link không được kèm tên");
    assert.equal(justSocial.facebookUrl, "https://facebook.com/gymini");

    const renamed = brandProfilePayload({ ...same, name: "Gymini Fitness" }, brand);
    assert.equal(renamed.name, "Gymini Fitness");

    // Khoảng trắng thừa không phải là đổi tên.
    assert.ok(!("name" in brandProfilePayload({ ...same, name: "  Gymini  " }, brand)));
  });

  it("payload luôn mang đủ bốn ô mạng xã hội, kể cả khi xoá trắng", () => {
    const brand: any = { id: "b1", name: "Gymini", facebookUrl: "https://facebook.com/cu" };
    const cleared = brandProfilePayload({ ...brandProfileFrom(brand), facebookUrl: "" }, brand);
    for (const s of SOCIAL_FIELDS) assert.ok(s.key in cleared, s.key);
    assert.equal(cleared.facebookUrl, "", "xoá trắng phải gửi chuỗi rỗng để máy chủ xoá, không phải bỏ trường");
  });

  it("đổi mật khẩu: đủ dài, khớp nhau, và phải khác mật khẩu cũ", () => {
    assert.equal(passwordChangeError("cu12345678", "moi12345678", "moi12345678"), null);
    assert.ok(passwordChangeError("", "moi12345678", "moi12345678"));
    assert.ok(passwordChangeError("cu12345678", "ngan", "ngan"));
    assert.ok(passwordChangeError("cu12345678", "moi12345678", "khac12345678"));
    assert.ok(passwordChangeError("same12345678", "same12345678", "same12345678"));
  });
});
