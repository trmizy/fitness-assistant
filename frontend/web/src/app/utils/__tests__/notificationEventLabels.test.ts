/**
 * N13A-12 / N13J-05(e): bell sub-label and PT-terms version never show raw English codes.
 * Run: npx tsx --test src/app/utils/__tests__/notificationEventLabels.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notificationEventLabel, NOTIFICATION_EVENT_LABEL_VI } from "../notificationEventLabels";
import { ptTermsVersionLabel } from "../ptTermsLabel";

describe("notificationEventLabel", () => {
  it("maps the two reported types to Vietnamese", () => {
    assert.equal(notificationEventLabel("CONTRACT_REQUESTED"), "Yêu cầu hợp đồng");
    assert.equal(notificationEventLabel("NUTRITION_PLAN_READY"), "Kế hoạch dinh dưỡng đã sẵn sàng");
  });
  it("labels the four branch lifecycle notices (FIX3-NOTIFY)", () => {
    assert.equal(notificationEventLabel("GYM_BRANCH_SUSPENDED"), "Chi nhánh bị tạm khoá");
    assert.equal(notificationEventLabel("GYM_BRANCH_SUSPENSION_LIFTED"), "Chi nhánh được mở khoá");
    assert.equal(notificationEventLabel("GYM_BRANCH_TEMPORARILY_CLOSED"), "Chi nhánh tạm đóng cửa");
    assert.equal(notificationEventLabel("GYM_BRANCH_REOPENED"), "Chi nhánh mở cửa lại");
  });
  it("unknown / empty type falls back to a Vietnamese word, never the code", () => {
    assert.equal(notificationEventLabel("SOMETHING_NEW"), "Thông báo");
    assert.equal(notificationEventLabel(undefined), "Thông báo");
  });
  it("covers every NotificationEventType of the user-service schema", () => {
    const schema = readFileSync(new URL("../../../../../../backend/services/user-service/prisma/schema.prisma", import.meta.url), "utf8");
    const block = /enum NotificationEventType \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const values = block.split("\n").map((l) => l.trim()).filter((l) => /^[A-Z][A-Z_]+$/.test(l));
    assert.ok(values.length > 40, `parsed ${values.length} enum values`);
    const missing = values.filter((v) => !(v in NOTIFICATION_EVENT_LABEL_VI));
    assert.deepEqual(missing, []);
  });
});

describe("ptTermsVersionLabel", () => {
  it("turns the internal id into a readable label", () => {
    assert.equal(ptTermsVersionLabel("2026-10-pt-draft-6"), "Điều khoản PT tháng 10/2026 (bản nháp 6)");
    assert.equal(ptTermsVersionLabel("2026-10-pt-2"), "Điều khoản PT tháng 10/2026 (bản 2)");
  });
  it("never echoes an unknown id", () => {
    assert.equal(ptTermsVersionLabel("abc-xyz"), "Bản điều khoản PT");
    assert.equal(ptTermsVersionLabel(null), "Không rõ phiên bản");
  });
});
