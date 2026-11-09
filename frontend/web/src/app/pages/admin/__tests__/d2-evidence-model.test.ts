/**
 * D2 / M4 - evidence model. Evidence label: TEST FIXTURE (pure functions + fixtures shaped like the collector's rows; no server, no browser).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d2-evidence-model.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as E from "../disputes/workspace/evidenceModel";
import { STORAGE_KEY_SECRET, allEvidenceKinds, evidenceRow, noScanRow, unavailableRow } from "../disputes/workspace/__fixtures__/evidenceFixtures";

const kinds = allEvidenceKinds();
const bySubject = (s: string) => kinds.find((k) => k.subject === s)!;
const textOf = (v: E.PayloadView) => JSON.stringify({ fields: v.fields, groups: v.groups, notes: v.notes, notProven: v.notProven });
const visible = (e: Parameters<typeof E.describePayload>[0]) => textOf(E.describePayload(e));

describe("D2 evidence - grouping by source", () => {
  it("groups follow the briefed source order and have Vietnamese titles", () => {
    const groups = E.buildEvidenceGroups(kinds);
    assert.equal(groups[0].title, "Buổi tập");
    assert.deepEqual(groups.map((g) => g.source).slice(0, 3), ["user-service.sessions", "user-service.contracts", "user-service.session_settlements"]);
    for (const g of groups) assert.doesNotMatch(g.title, /service|\./, g.source);
    assert.equal(E.sourceTitle("some.unknown"), "Nguồn khác");
  });
  it("no raw subject or source string is ever a title", () => {
    for (const k of kinds) {
      assert.doesNotMatch(E.subjectTitle(k.subject), /[A-Z]{3,}_[A-Z]/, k.subject);
    }
    assert.equal(E.subjectTitle("BRAND_NEW_SUBJECT"), "Dữ liệu khác");
  });
});

describe("D2 evidence - version history via supersedesId", () => {
  it("the row nobody supersedes is current; older versions are listed newest first", () => {
    const v1 = evidenceRow("SESSION_ROW", { id: "v1", snapshotVersion: 1, capturedAt: "2026-11-01T03:00:00.000Z" });
    const v2 = evidenceRow("SESSION_ROW", { id: "v2", snapshotVersion: 2, supersedesId: "v1", capturedAt: "2026-11-01T04:00:00.000Z" });
    const v3 = evidenceRow("SESSION_ROW", { id: "v3", snapshotVersion: 3, supersedesId: "v2", capturedAt: "2026-11-01T05:00:00.000Z" });
    const [g] = E.buildEvidenceGroups([v2, v1, v3]);
    assert.equal(g.items.length, 1);
    assert.equal(g.items[0].current.id, "v3");
    assert.deepEqual(g.items[0].older.map((o) => o.id), ["v2", "v1"]);
  });
  it("a broken chain falls back to the highest version, never throws", () => {
    const a = evidenceRow("SESSION_ROW", { id: "a", snapshotVersion: 1, supersedesId: "ghost" });
    const b = evidenceRow("SESSION_ROW", { id: "b", snapshotVersion: 4, supersedesId: "ghost" });
    assert.equal(E.currentOf([a, b]).id, "b");
  });
  it("different subjects are different slots", () => {
    const groups = E.buildEvidenceGroups([evidenceRow("ROOM_PT_JOINED_AT"), evidenceRow("ROOM_CLIENT_JOINED_AT")]);
    assert.equal(groups[0].items.length, 2);
  });
  it("empty / null input is an empty list", () => {
    assert.deepEqual(E.buildEvidenceGroups(null), []);
    assert.deepEqual(E.buildEvidenceGroups([]), []);
  });
});

describe("D2 evidence - badges", () => {
  it("TECH_GAP / UNAVAILABLE = 'Không đọc được nguồn', never 'vắng'", () => {
    const e = unavailableRow();
    assert.equal(E.isUnreadable(e), true);
    const b = E.evidenceBadges(e);
    assert.ok(b.some((x) => x.label === "Không đọc được nguồn"));
    const all = JSON.stringify([b, E.describePayload(e)]);
    assert.doesNotMatch(all, /PT vắng|đã vắng mặt|vắng mặt\./);
    assert.match(all, /không phải bằng chứng vắng mặt/);
    assert.doesNotMatch(all, /UNAVAILABLE/);
  });
  it("captureStatus UNAVAILABLE alone is enough", () => {
    assert.equal(E.isUnreadable({ provenanceType: "SERVER_OBSERVED", captureStatus: "UNAVAILABLE" }), true);
    assert.equal(E.isUnreadable({ provenanceType: "SERVER_OBSERVED", captureStatus: "OK" }), false);
  });
  it("DERIVED is labelled as not an independent source", () => {
    const b = E.evidenceBadges(bySubject("GYM_PT_CHECK_INS_QUALIFYING_LINK"));
    assert.ok(b.some((x) => x.label === "Dữ liệu dẫn xuất, không phải nguồn độc lập"));
  });
  it("party-submitted = 'Bên liên quan tự khai - chưa xác minh'; a stored file adds a verified-bytes badge but keeps the claim badge", () => {
    const doc = E.evidenceBadges(bySubject("PARTY_DOC:11")).map((b) => b.label);
    assert.ok(doc.includes("Bên liên quan tự khai - chưa xác minh"));
    assert.ok(!doc.some((l) => /đã xác minh/.test(l)));
    const file = E.evidenceBadges(bySubject("PARTY_FILE:22")).map((b) => b.label);
    assert.ok(file.includes("Bên liên quan tự khai - chưa xác minh"));
    assert.ok(file.includes("Máy chủ đã xác minh (chỉ phần tệp)"));
    assert.equal(file.filter((l) => l === "Bên liên quan tự khai - chưa xác minh").length, 1);
  });
  it("sensitivity pills for SENSITIVE and RESTRICTED only", () => {
    assert.ok(E.evidenceBadges(bySubject("CONTRACT_FINANCIAL_SNAPSHOT")).some((b) => b.label === "Nhạy cảm"));
    assert.ok(E.evidenceBadges(bySubject("PARTY_DOC:11")).some((b) => /Hạn chế/.test(b.label)));
    assert.ok(!E.evidenceBadges(bySubject("SESSION_ROW")).some((b) => /Nhạy cảm|Hạn chế/.test(b.label)));
  });
  it("provenance text: the server sentence, or our wording when the server sent a raw enum", () => {
    assert.match(E.provenanceText(bySubject("GYM_PT_CHECK_INS")), /check-in gym không chứng minh buổi dạy PT đã diễn ra/);
    assert.equal(E.provenanceText({ provenanceLabel: "DERIVED", provenanceType: "DERIVED" }), "Dữ liệu dẫn xuất, không phải nguồn độc lập");
    assert.equal(E.provenanceText({ provenanceLabel: "", provenanceType: "WHATEVER" as never }), "Nguồn chưa rõ");
  });
});

describe("D2 evidence - payload is readable, never absence", () => {
  it("found:false = 'Không có bản ghi quét trong ngày', never 'PT vắng'", () => {
    const v = E.describePayload(noScanRow());
    const t = textOf(v);
    assert.match(t, /Không có bản ghi quét trong ngày/);
    assert.match(t, /Không có bản ghi không chứng minh PT vắng mặt/);
    assert.doesNotMatch(t.replace(/Không có bản ghi không chứng minh PT vắng mặt/g, ""), /PT vắng/);
  });
  it("payload.notProven is shown for gym check-ins", () => {
    for (const s of ["GYM_PT_CHECK_INS", "GYM_CHECK_INS_SELF_REPORTED", "GYM_CHECK_INS_STAFF_ATTESTED"]) {
      assert.match(E.describePayload(bySubject(s)).notProven ?? "", /Check-in gym không chứng minh buổi dạy PT đã diễn ra/, s);
      assert.ok(E.GYM_CHECKIN_SUBJECTS.includes(s));
    }
  });
  it("an empty check-in list does not prove absence", () => {
    const v = E.describePayload(bySubject("GYM_CHECK_INS_SELF_REPORTED"));
    assert.match(JSON.stringify(v.groups), /không chứng minh khách vắng mặt/);
  });
  it("room join NULL is 'not recorded', not 'absent'", () => {
    const t = visible(bySubject("ROOM_CLIENT_JOINED_AT"));
    assert.match(t, /Không ghi nhận/);
    assert.match(t, /không chứng minh người đó vắng mặt/);
  });
  it("OFFLINE room slot is 'not applicable' in our words (no OFFLINE token)", () => {
    const e = bySubject("ROOM_PT_JOINED_AT");
    const t = visible(e);
    assert.match(t, /Buổi tập trực tiếp nên không có phòng trực tuyến/);
    assert.doesNotMatch(t, /OFFLINE/);
  });
  it("the SESSION_ROW payload becomes labelled fields", () => {
    const v = E.describePayload(bySubject("SESSION_ROW"));
    const m = Object.fromEntries(v.fields.map((f) => [f.label, f.value]));
    assert.equal(m["Trạng thái buổi"], "Đang khiếu nại");
    assert.equal(m["Hình thức"], "Trực tiếp");
    assert.equal(m["Loại khiếu nại ghi trên buổi"], "Khách báo PT vắng, PT phản đối");
    assert.equal(m["Đã trừ quyền buổi"], "Không");
    assert.equal(v.technical.length, 0);
  });
  it("contract: money is formatted from the string, enum words are Vietnamese", () => {
    const v = E.describePayload(bySubject("CONTRACT_SNAPSHOT"));
    const m = Object.fromEntries(v.fields.map((f) => [f.label, f.value]));
    assert.match(m["Giá hợp đồng"], /3\.000\.000/);
    assert.equal(m["Loại gói"], "Gói nhiều buổi");
    assert.equal(m["Trạng thái hợp đồng"], "Đang hiệu lực");
  });
  it("settlements: kind/status in words, idempotency key never shown, 'SETTLED' is not 'money arrived'", () => {
    const v = E.describePayload(bySubject("SETTLEMENTS"));
    const t = textOf(v);
    assert.match(t, /Hoàn tiền do PT vắng/);
    assert.match(t, /chưa có nghĩa tiền đã về/);
    assert.doesNotMatch(t, /PT_NO_SHOW:abc|idempotency/i);
    assert.doesNotMatch(JSON.stringify(v.technical), /PT_NO_SHOW:abc/);
  });
  it("audit log rows go to the technical block, summary stays readable", () => {
    const v = E.describePayload(bySubject("AUDIT_LOG:SESSION"));
    assert.equal(v.fields.find((f) => f.label === "Số dòng nhật ký")!.value, "1");
    assert.ok(v.technical.length >= 1);
  });
  it("qualifying link says it is derived and shows a count, not ids", () => {
    const v = E.describePayload(bySubject("GYM_PT_CHECK_INS_QUALIFYING_LINK"));
    assert.equal(v.fields.find((f) => f.label === "Số buổi gắn với lần quét")!.value, "2");
    assert.match(v.notes.join(" "), /không phải một nguồn độc lập/);
  });
  it("staff-attested rows name the method in words", () => {
    const t = visible(bySubject("GYM_CHECK_INS_STAFF_ATTESTED"));
    assert.match(t, /Mã OTP của khách/);
    assert.match(t, /Nhân viên phòng tập check-in hộ/);
    assert.doesNotMatch(t, /MEMBER_OTP|GYM_STAFF/);
  });
  it("party document: the hash is labelled as the party's own claim and no file is claimed", () => {
    const v = E.describePayload(bySubject("PARTY_DOC:11"));
    const t = textOf(v);
    assert.match(t, /Mã băm do bên nộp tự khai \(chưa xác minh\)/);
    assert.match(t, /Chưa có tệp nào được lưu/);
    assert.doesNotMatch(t, /DESIGN_REQUIRED/);
  });
});

describe("D2 evidence - R-15: the storage key never reaches the screen", () => {
  it("storedFile.key is stripped from the stripped payload, the visible fields and the technical block", () => {
    const e = bySubject("PARTY_FILE:22");
    const stripped = JSON.stringify(E.stripInternal(e.payload));
    assert.doesNotMatch(stripped, new RegExp(STORAGE_KEY_SECRET.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
    const v = E.describePayload(e);
    const all = JSON.stringify(v);
    assert.doesNotMatch(all, /secret-storage-key/);
    assert.doesNotMatch(all, /cases\/11111111/);
    // what a reader may see about the file
    assert.match(all, /Ảnh|Tệp PDF/);
    assert.match(all, /20\.0 KB/);
    assert.match(all, /chỉ cho nội dung tệp/);
    assert.match(all, /Chưa mở xem tệp được ở màn này/);
  });
  it("an unknown subject carrying a `storedFile.key` still hides it", () => {
    const e = evidenceRow("SOMETHING_NEW", { payload: { storedFile: { key: "SECRET-KEY-XYZ", serverVerified: true, sha256: "1".repeat(64) }, other: 1 } });
    assert.doesNotMatch(JSON.stringify(E.describePayload(e)), /SECRET-KEY-XYZ/);
  });
  it("there is no file entry point: no URL to the file route is ever built", () => {
    for (const k of kinds) assert.doesNotMatch(JSON.stringify(E.describePayload(k)), /evidence\/.+\/file|\/file\b/);
  });
});

describe("D2 evidence - unknown payloads go to the collapsed technical block", () => {
  it("unknown subject: everything technical, nothing guessed", () => {
    const v = E.describePayload(evidenceRow("SOMETHING_NEW", { payload: { a: 1, b: "x" } }));
    assert.equal(v.fields.length, 0);
    assert.deepEqual(v.technical.map((t) => t.label), ["a", "b"]);
  });
  it("an unknown key on a known subject is technical, the known keys stay readable", () => {
    const e = evidenceRow("SESSION_ROW", { payload: { status: "DISPUTED", brandNewKey: 42 } });
    const v = E.describePayload(e);
    assert.equal(v.fields[0].value, "Đang khiếu nại");
    assert.deepEqual(v.technical.map((t) => t.label), ["brandNewKey"]);
  });
  it("a payload of any shape never throws", () => {
    for (const payload of [null, undefined, 5, "x", [], [1, 2], { rows: "no" }, { rows: [null, 1, {}] }]) {
      for (const s of ["SESSION_ROW", "SETTLEMENTS", "CALL_SESSIONS", "PARTY_FILE:1", "GYM_CHECK_INS_SELF_REPORTED", "ZZZ"]) {
        assert.doesNotThrow(() => E.describePayload(evidenceRow(s, { payload })), `${s} ${JSON.stringify(payload)}`);
      }
    }
  });
});

describe("D2 evidence - server notes with internal codes are never echoed", () => {
  it("sanitizeNote maps known sentences and drops the rest", () => {
    assert.match(E.sanitizeNote("Buổi tập trực tuyến (ONLINE): không áp dụng quét QR tại phòng tập")!, /trực tuyến/);
    assert.match(E.sanitizeNote("Hợp đồng không gắn phòng tập (thiếu gymId): không suy đoán")!, /không gắn phòng tập/);
    assert.equal(E.sanitizeNote("Bản ghi kết nối do máy chủ chứng kiến (SERVER_OBSERVED) ..."), null);
    assert.equal(E.sanitizeNote(undefined), null);
  });
  it("no rendered text of any fixture kind contains an internal token", () => {
    for (const k of kinds.concat([noScanRow(), unavailableRow()])) {
      const t = visible(k) + E.provenanceText(k) + JSON.stringify(E.evidenceBadges(k));
      assert.doesNotMatch(t, /SERVER_OBSERVED|SELF_REPORTED|TECH_GAP|UNAVAILABLE|NOT_APPLICABLE|CLIENT_CLAIMED|DESIGN_REQUIRED|\bE[123]\b/, k.subject);
    }
  });
});

describe("D2 evidence - cross references", () => {
  it("assessment references show our title and a short ref, not a bare uuid", () => {
    const rows = [evidenceRow("SESSION_ROW", { id: "abcdef12-0000-4000-8000-000000000000" })];
    assert.equal(E.evidenceRefText("abcdef12-0000-4000-8000-000000000000", rows), "Thông tin buổi tập (mã abcdef12)");
    assert.match(E.evidenceRefText("zzzzzzzz-9", rows), /không còn trong hồ sơ/);
  });
  it("copy for the tab", () => {
    assert.equal(E.VIEW_LOGGED_NOTE, "Mỗi lần xem được ghi lại.");
    assert.equal(E.formatBytes(2048), "2.0 KB");
  });
});
