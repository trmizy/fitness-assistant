/**
 * B1-OTHER (CODE AUDIT, đọc mã nguồn - không phải E2E): các hành động rủi ro không liên quan tiền
 * ở AdminGymModeration / AdminPartnersPage / PTManagement phải qua hộp thoại xác nhận, không dùng
 * window.confirm / alert, và hộp thoại tự dựng phải là Radix Dialog.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "src/app/pages/admin");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const gym = read("AdminGymModeration.tsx");
const partners = read("AdminPartnersPage.tsx");
const pt = read("PTManagement.tsx");

describe("b1other - không còn hộp thoại gốc của trình duyệt", () => {
  for (const [name, src] of [["AdminGymModeration", gym], ["AdminPartnersPage", partners], ["PTManagement", pt]] as const) {
    it(`${name}: không window.confirm / alert()`, () => {
      assert.equal(/window\.confirm|(^|[^.\w])alert\(|(^|[^.\w])confirm\(/m.test(src), false);
    });
  }
});

describe("b1other - xác nhận trước hành động rủi ro", () => {
  it("duyệt/từ chối chi nhánh đi qua ConfirmDialog, nút không gọi mutate trực tiếp", () => {
    assert.match(gym, /<ConfirmDialog/);
    assert.equal(/onClick=\{\(\) => setStatusMutation\.mutate/.test(gym), false);
  });
  it("thu hồi / buộc đăng xuất / chuyển quyền / thu hồi thư mời qua ConfirmDialog", () => {
    assert.equal(/onClick=\{\(\) => (revokeMutation|forceLogoutMutation|transferMutation|revokeInviteMutation)\.mutate/.test(partners), false);
    assert.match(partners, /kind: "revoke"/);
    assert.match(partners, /kind: "transfer"/);
    assert.match(partners, /Không thể hoàn tác/);
  });
  it("đổi chiết khấu hiện giá trị cũ -> mới", () => {
    assert.match(partners, /fmtRate\(oldRate\).*fmtRate\(newRate\)/s);
  });
  it("duyệt/từ chối hồ sơ PT qua ConfirmDialog; từ chối bắt buộc có lý do", () => {
    assert.equal(/onClick=\{\(\) =>\s*actionMutation\.mutate\(\{\s*action: "(APPROVE|REJECT)"/.test(pt), false);
    assert.match(pt, /rejectNeedsReason/);
  });
});

describe("b1other - hộp thoại tạm khoá/chấm dứt là Radix Dialog", () => {
  it("không còn lớp phủ fixed inset-0 tự dựng trong AdminPartnersPage", () => {
    assert.equal(/fixed inset-0/.test(partners), false);
    assert.match(partners, /<Dialog open/);
  });
});

describe("b1other - lỗi tải không hiện thành 'trống'", () => {
  it("mỗi trang có trạng thái lỗi + Thử lại", () => {
    assert.match(gym, /admin-gym-load-error/);
    assert.match(partners, /admin-partners-load-error/);
    assert.match(pt, /pt-applications-load-error/);
  });
});
