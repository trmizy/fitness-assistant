/**
 * FIX2-ADMIN (15/11/2026): raw codes in the admin partner screens (N14A-05 / N14G-08 / N14A-04).
 * TEST FIXTURE: pure functions + CODE AUDIT of the wiring. Run: npx tsx --test src/app/utils/__tests__/adminPartnerLabels.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PARTNER_AUDIT_ACTION_VI, docTypeVi, humanizeCodes, partnerAuditActionVi, partnerAuditDetailVi, readableCode } from "../adminPartnerLabels";

const RAW = /[A-Z]{3,}_[A-Z_]{3,}/;
const REPO = path.resolve(process.cwd(), "../..");

describe("partner audit log wording", () => {
  it("every PartnerAuditAction of gym-service's schema has a Vietnamese label that is not the code", () => {
    const schema = fs.readFileSync(path.join(REPO, "backend/services/gym-service/prisma/schema.prisma"), "utf8");
    const from = schema.indexOf("enum PartnerAuditAction {");
    const enumBody = schema.slice(from + "enum PartnerAuditAction {".length, schema.indexOf("}", from));
    const codes = enumBody.split("\n").map((l) => l.trim()).filter((l) => /^[A-Z][A-Z_]+$/.test(l));
    assert.ok(codes.length >= 35, "parsed " + codes.length + " actions");
    for (const c of codes) {
      assert.ok(PARTNER_AUDIT_ACTION_VI[c], c + " has no label");
      assert.doesNotMatch(PARTNER_AUDIT_ACTION_VI[c], RAW, c);
    }
  });

  it("the codes named in the bug log read as Vietnamese", () => {
    assert.equal(partnerAuditActionVi("LISTING_SUBMITTED"), "Gửi tin giới thiệu chờ duyệt");
    assert.equal(partnerAuditActionVi("AMENITY_PROPOSED"), "Đề xuất tiện ích mới");
    assert.equal(partnerAuditActionVi("APPLICATION_APPROVED"), "Phê duyệt hồ sơ đăng ký");
    assert.equal(partnerAuditActionVi("DOCUMENT_ACCEPTED"), "Chấp nhận giấy tờ");
  });

  it("an unknown or empty action never shows the raw code", () => {
    assert.equal(partnerAuditActionVi("SOMETHING_NEW_FROM_THE_SERVER"), "Thao tác khác");
    assert.equal(partnerAuditActionVi(null), "Thao tác khác");
    assert.equal(partnerAuditActionVi(undefined), "Thao tác khác");
  });

  it("branch status changes read by what the admin did, with the from -> to line", () => {
    assert.equal(partnerAuditActionVi("GYM_ADMIN_STATUS_CHANGED", { lifecycleAction: "SUSPEND" }), "Tạm khoá chi nhánh");
    assert.equal(partnerAuditActionVi("GYM_ADMIN_STATUS_CHANGED", { lifecycleAction: "REOPEN" }), "Mở cửa lại chi nhánh");
    assert.equal(partnerAuditActionVi("GYM_ADMIN_STATUS_CHANGED", { from: "PENDING_REVIEW", to: "APPROVED" }), "Đổi trạng thái chi nhánh");
    assert.equal(partnerAuditDetailVi("GYM_ADMIN_STATUS_CHANGED", { from: "APPROVED", to: "SUSPENDED" }), 'Từ "đang hoạt động" sang "đang tạm khoá"');
    assert.equal(partnerAuditDetailVi("DOCUMENT_ACCEPTED", { docType: "BUSINESS_LICENSE", version: 2 }), "Giấy phép kinh doanh");
    assert.equal(partnerAuditDetailVi("PARTNER_CREATED", null), null);
  });
});

describe("document types and free text", () => {
  it("docTypeVi", () => {
    assert.equal(docTypeVi("BUSINESS_LICENSE"), "Giấy phép kinh doanh");
    assert.equal(docTypeVi("REPRESENTATIVE_ID"), "CCCD người đại diện");
    assert.equal(docTypeVi("PREMISES_PROOF"), "Giấy tờ mặt bằng");
    assert.equal(docTypeVi("NEW_KIND_OF_PAPER"), "new kind of paper");
    assert.equal(docTypeVi(null), "Giấy tờ");
  });

  it("approval blockers: the document type inside the sentence is translated", () => {
    assert.equal(humanizeCodes("Giấy tờ BUSINESS_LICENSE chưa được chấp nhận"), 'Giấy tờ "Giấy phép kinh doanh" chưa được chấp nhận');
    assert.equal(humanizeCodes("Giấy tờ REPRESENTATIVE_ID chưa được chấp nhận"), 'Giấy tờ "CCCD người đại diện" chưa được chấp nhận');
    assert.equal(humanizeCodes("Giấy tờ PREMISES_PROOF chưa được chấp nhận"), 'Giấy tờ "Giấy tờ mặt bằng" chưa được chấp nhận');
  });

  it("partner status and unknown codes inside text never stay raw", () => {
    assert.equal(humanizeCodes("Hồ sơ đang ở dạng (PROSPECT)"), "Hồ sơ đang ở dạng (tiềm năng)");
    assert.equal(humanizeCodes("Lỗi UNKNOWN_THING_HERE xảy ra"), "Lỗi unknown thing here xảy ra");
    assert.equal(humanizeCodes("Còn 2 vấn đề chưa được đóng"), "Còn 2 vấn đề chưa được đóng");
    assert.equal(humanizeCodes(null), "");
    assert.equal(readableCode("A_B_C"), "a b c");
  });
});

describe("wiring (CODE AUDIT of the source)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src/app/pages/admin", rel), "utf8");
  it("the partner Nhật ký tab, the application blockers and the PROSPECT hint use the central labels", () => {
    const partners = read("AdminPartnersPage.tsx");
    assert.match(partners, /partnerAuditActionVi\(l\.action, l\.metadata\)/);
    assert.doesNotMatch(partners, /AUDIT_ACTION_LABEL/);
    assert.doesNotMatch(partners, /dạng tiềm năng \(PROSPECT\)/);
    const apps = read("AdminApplicationsPanel.tsx");
    assert.match(apps, /humanizeCodes\(b\?\.message/);
  });
});
