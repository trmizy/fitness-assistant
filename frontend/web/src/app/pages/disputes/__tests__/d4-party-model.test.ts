/**
 * D4 / M12 party-side model. Evidence label: TEST FIXTURE (pure functions; no server, no browser).
 * Run: npx tsx --test src/app/pages/disputes/__tests__/d4-party-model.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CASE_STATUSES, CASE_TYPES, PROVENANCE_TYPES, type PartyCaseDetail } from "../../admin/disputes/disputeCaseTypes";
import { parseDisputeErrorBody } from "../../admin/disputes/disputeCaseErrors";
import { IDS, partyDetailFixture } from "../../admin/disputes/__fixtures__/disputeCaseFixtures";
import * as L from "../partyLabels";
import * as M from "../partyModel";

const detail = (over: Partial<PartyCaseDetail> = {}): PartyCaseDetail => ({ ...partyDetailFixture(), ...over });
const ev = (over: Partial<PartyCaseDetail["evidence"][number]> = {}): PartyCaseDetail["evidence"][number] => ({
  id: "e1",
  provenanceType: "SERVER_OBSERVED",
  source: "user-service.sessions",
  subject: "SESSION_ROW",
  eventAt: "2026-11-01T03:00:00.000Z",
  capturedAt: "2026-11-01T03:05:00.000Z",
  captureStatus: "OK",
  snapshotVersion: 1,
  payload: {},
  verificationStatus: "NOT_APPLICABLE",
  mine: false,
  ...over,
});
const st = (over: Partial<PartyCaseDetail["statements"][number]> = {}): PartyCaseDetail["statements"][number] => ({
  id: "s1",
  partyRole: "PT",
  version: 1,
  source: "SUBMITTED",
  text: "Tôi đã đến đúng giờ",
  supplementReason: null,
  createdAt: "2026-11-01T04:00:00.000Z",
  mine: true,
  ...over,
});

describe("D4 wording - every enum has a party sentence, none is an admin process word", () => {
  it("all 11 statuses, all 4 types have labels and notes", () => {
    for (const s of CASE_STATUSES) {
      assert.ok(L.PARTY_STATUS_LABEL[s], s);
      assert.ok(L.PARTY_STATUS_NOTE[s], s);
    }
    for (const t of CASE_TYPES) assert.ok(L.PARTY_TYPE_LABEL[t], t);
  });
  it("every provenance type has a party sentence and none says 'máy chủ' or names the admin", () => {
    for (const t of PROVENANCE_TYPES) assert.ok(L.PARTY_PROVENANCE_LABEL[t], t);
    assert.doesNotMatch(Object.values(L.PARTY_PROVENANCE_LABEL).join(" | "), /[Mm]áy chủ/);
    assert.equal(L.partyProvenanceLabel("NEW"), "Nguồn chưa rõ");
  });
  it("unknown values fall back to a plain sentence, never the raw enum", () => {
    assert.equal(L.partyStatusLabel("NEW_STATUS"), "Đang được xử lý");
    assert.equal(L.partyTypeLabel("X"), "Khiếu nại về buổi tập");
    assert.equal(L.partyRoleLabel(null), "Chưa rõ vai trò");
    assert.equal(L.claimantLabel("ALIEN"), "Bên khác nêu");
  });
  it("no label mentions notification, the other side's answer, an appeal, an outcome promise or internal codes", () => {
    const all = [...Object.values(L.PARTY_STATUS_LABEL), ...Object.values(L.PARTY_STATUS_NOTE), ...Object.values(L.PARTY_TYPE_LABEL), L.CAN_SUBMIT_NOTE, L.CANNOT_SUBMIT_NOTE, L.MONEY_STATUS_NOTE, L.NO_FILE_NOTE, L.NO_AUTO_REFRESH_NOTE, L.VISIBLE_ONLY_NOTE].join("\n");
    assert.doesNotMatch(all, /thông báo|đã báo|phúc thẩm|kháng cáo|bên kia|D77|B-1|FH-8|I6\b|bốn mắt/i);
    assert.doesNotMatch(all, /không bị trừ/i, "DQ-2(a): never 'buổi tập không bị trừ'");
    assert.doesNotMatch(all, /được hoàn|hoàn tiền|hoàn lại/i, "no outcome promised");
    assert.doesNotMatch(all, /\b[A-Z]{3,}_[A-Z_]{3,}\b/);
  });
  it("DECISION_APPROVED never reads as 'done' or 'money arrived'", () => {
    assert.match(L.PARTY_STATUS_NOTE.DECISION_APPROVED, /chưa có nghĩa/);
    assert.doesNotMatch(L.PARTY_STATUS_LABEL.DECISION_APPROVED, /thực hiện|hoàn tất|đã trả/);
  });
});

describe("D4 forms - statement (B3: text 1..5000, supplementReason 1..2000 from the second one)", () => {
  it("first statement: text only, trimmed; no reason key on the wire", () => {
    const r = M.validateStatement({ text: "  Tôi có mặt  ", supplementReason: "" }, false);
    assert.deepEqual(r, { ok: true, body: { text: "Tôi có mặt" } });
  });
  it("empty / blank / 5001 chars are refused, 5000 passes", () => {
    assert.equal(M.validateStatement({ text: "   ", supplementReason: "" }, false).ok, false);
    assert.equal(M.validateStatement({ text: "a".repeat(5001), supplementReason: "" }, false).ok, false);
    assert.equal(M.validateStatement({ text: "a".repeat(5000), supplementReason: "" }, false).ok, true);
  });
  it("from the second statement the reason is required (1..2000)", () => {
    const missing = M.validateStatement({ text: "x", supplementReason: " " }, true);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.errors.supplementReason);
    assert.equal(M.validateStatement({ text: "x", supplementReason: "y".repeat(2001) }, true).ok, false);
    assert.deepEqual(M.validateStatement({ text: "x", supplementReason: " có thêm ảnh " }, true), { ok: true, body: { text: "x", supplementReason: "có thêm ảnh" } });
  });
  it("a reason typed when none is required is still sent (the server ignores it for version 1) but is length-checked", () => {
    assert.equal(M.validateStatement({ text: "x", supplementReason: "y".repeat(2001) }, false).ok, false);
  });
  it("next version counts statements of MY ROLE (the server rule), not only the ones I wrote", () => {
    assert.equal(M.nextStatementVersion(detail()), 1);
    assert.equal(M.statementNeedsReason(detail()), false);
    const d = detail({ statements: [st({ partyRole: "PT", version: 1, mine: false, source: "LEGACY_FIELD" })] });
    assert.equal(M.nextStatementVersion(d), 2, "a legacy v1 recorded for my role makes my first UI statement version 2");
    assert.equal(M.statementNeedsReason(d), true);
    const other = detail({ statements: [st({ partyRole: "CLIENT", version: 3, mine: false })] });
    assert.equal(M.nextStatementVersion(other), 1, "a statement of the other role does not count");
    assert.equal(M.nextStatementVersion(detail({ statements: [st({ version: 1 }), st({ id: "s2", version: 2 })] })), 3);
  });
});

describe("D4 forms - document (B4: description 1..2000, title <=200, fileName <=255, sha256 exactly 64 hex)", () => {
  const ok = { description: "Ảnh chụp màn hình tin nhắn", title: "", fileName: "", sha256: "a".repeat(64) };
  it("minimal body has only description + sha256 (optional keys absent)", () => {
    assert.deepEqual(M.validateDocument(ok), { ok: true, body: { description: "Ảnh chụp màn hình tin nhắn", sha256: "a".repeat(64) } });
  });
  it("optional title / fileName are trimmed and included", () => {
    const r = M.validateDocument({ ...ok, title: " Tin nhắn ", fileName: " anh.png " });
    assert.deepEqual(r, { ok: true, body: { description: "Ảnh chụp màn hình tin nhắn", sha256: "a".repeat(64), title: "Tin nhắn", fileName: "anh.png" } });
  });
  it("limits: description 2000/2001, title 200/201, fileName 255/256", () => {
    assert.equal(M.validateDocument({ ...ok, description: "d".repeat(2000) }).ok, true);
    assert.equal(M.validateDocument({ ...ok, description: "d".repeat(2001) }).ok, false);
    assert.equal(M.validateDocument({ ...ok, description: " " }).ok, false);
    assert.equal(M.validateDocument({ ...ok, title: "t".repeat(200) }).ok, true);
    assert.equal(M.validateDocument({ ...ok, title: "t".repeat(201) }).ok, false);
    assert.equal(M.validateDocument({ ...ok, fileName: "f".repeat(255) }).ok, true);
    assert.equal(M.validateDocument({ ...ok, fileName: "f".repeat(256) }).ok, false);
  });
  it("sha256: exactly 64 hex; 63, 65, non-hex are refused; upper case and a trailing file name are normalised", () => {
    for (const bad of ["a".repeat(63), "a".repeat(65), "g".repeat(64), "", "  "]) assert.equal(M.validateDocument({ ...ok, sha256: bad }).ok, false, bad);
    const up = M.validateDocument({ ...ok, sha256: "ABCDEF0123456789".repeat(4) });
    assert.deepEqual(up.ok && up.body.sha256, "abcdef0123456789".repeat(4));
    const sum = M.validateDocument({ ...ok, sha256: `${"b".repeat(64)}  report.pdf` });
    assert.deepEqual(sum.ok && sum.body.sha256, "b".repeat(64));
  });
  it("the body can not carry a user id, a file or any other key", () => {
    const r = M.validateDocument({ ...ok, userId: "x", file: new Uint8Array(3) } as never);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(Object.keys(r.body).sort(), ["description", "sha256"]);
  });
});

describe("D4 errors - server answers become form feedback in party words", () => {
  const fb = (status: number | null, body: unknown) => M.feedbackFromBody(status, body, true);
  it("INVALID_INPUT marks the fields inline with OUR messages (paths 'text' and 'body.sha256' both match)", () => {
    const f = fb(400, { error: "Dữ liệu gửi lên không hợp lệ", code: "INVALID_INPUT", fields: [{ path: "text", message: "String must contain at least 1" }, { path: "body.sha256", message: "sha256 phải gồm 64 ký tự thập lục phân" }, { path: "zzz", message: "?" }] });
    assert.equal(f.fieldErrors.text, M.FIELD_MESSAGE.text);
    assert.equal(f.fieldErrors.sha256, M.FIELD_MESSAGE.sha256);
    assert.equal(Object.keys(f.fieldErrors).length, 2);
    assert.match(f.message, /ô được đánh dấu/);
    assert.doesNotMatch(JSON.stringify(f), /String must contain/);
  });
  it("SUPPLEMENT_REASON_REQUIRED reveals the reason field with an inline message", () => {
    const f = fb(400, { error: "Bổ sung lời khai cần ghi rõ lý do bổ sung", code: "SUPPLEMENT_REASON_REQUIRED" });
    assert.equal(f.showReasonField, true);
    assert.ok(f.fieldErrors.supplementReason);
    assert.equal(f.mustReload, false);
  });
  it("CASE_STATE_NOT_ALLOWED asks for a reload and names the step in party words (no admin label)", () => {
    const f = fb(409, { error: "x", code: "CASE_STATE_NOT_ALLOWED", details: { status: "AWAITING_APPROVAL", allowed: [] } });
    assert.equal(f.mustReload, true);
    assert.match(f.message, /Đề xuất xử lý đang chờ phê duyệt/);
    assert.doesNotMatch(f.message, /bốn mắt|Chờ phê duyệt»/);
    assert.equal(fb(409, { error: "x", code: "CASE_STATE_NOT_ALLOWED" }).mustReload, true);
  });
  it("STATEMENT_VERSION_CONFLICT asks for a reload", () => {
    const f = fb(409, { error: "x", code: "STATEMENT_VERSION_CONFLICT" });
    assert.equal(f.mustReload, true);
    assert.match(f.message, /tải lại/i);
  });
  it("404 CASE_NOT_FOUND = 'không tìm thấy', never says whether the case exists", () => {
    const f = fb(404, { error: "Không tìm thấy hồ sơ", code: "CASE_NOT_FOUND" });
    assert.equal(f.notFound, true);
    assert.match(f.message, /Không tìm thấy hồ sơ/);
    assert.doesNotMatch(f.message, /không có quyền|của người khác|tồn tại/i);
  });
  it("a network failure / 500 on a write is an UNKNOWN outcome: reload offered, resend allowed (same key replays)", () => {
    const net = fb(null, null);
    assert.equal(net.outcomeUnknown, true);
    assert.match(net.message, /Chưa biết thao tác đã được ghi hay chưa/);
    const e500 = fb(500, { error: "Máy chủ lỗi", code: "INTERNAL_ERROR" });
    assert.equal(e500.outcomeUnknown, true);
    assert.equal(e500.mustReload, false);
  });
  it("401 and unknown codes never show a raw code or English", () => {
    const a = parseDisputeErrorBody(401, { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { action: "write" });
    assert.match(a.message, /đăng nhập/);
    const u = fb(409, { error: "Something odd happened", code: "NEW_CODE" });
    assert.doesNotMatch(u.message, /NEW_CODE|Something odd/);
  });
});

describe("D4 list (B1)", () => {
  const item = (id: string, createdAt: string, over = {}) => ({ id, sessionId: "sess-1", type: "PT_NO_SHOW_CLAIM" as const, status: "COLLECTING" as const, role: "PT" as const, createdAt, ...over });
  it("rows are newest first, in party words, with no session id or case id in any visible text", () => {
    const rows = M.listRows([item("a", "2026-10-01T00:00:00.000Z"), item("b", "2026-11-01T00:00:00.000Z", { role: "CLIENT", status: "DECISION_APPROVED" })]);
    assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
    assert.equal(rows[0].roleLabel, "Khách hàng");
    assert.equal(rows[1].roleLabel, "Huấn luyện viên (PT)");
    assert.equal(rows[0].statusLabel, "Đã có quyết định");
    const visible = rows.map((r) => [r.title, r.statusLabel, r.roleLabel, r.createdLabel].join("|")).join("\n");
    assert.doesNotMatch(visible, /sess-1|COLLECTING|PT_NO_SHOW/);
  });
  it("null / undefined / empty -> []; a missing role is stated, not guessed", () => {
    assert.deepEqual(M.listRows(null), []);
    assert.deepEqual(M.listRows(undefined), []);
    assert.equal(M.listRows([item("a", "2026-10-01T00:00:00.000Z", { role: null })])[0].roleLabel, "Chưa rõ vai trò");
  });
});

describe("D4 detail (B2)", () => {
  it("own document: 'của bạn' marker, unverified label, its declared facts, no file", () => {
    const d = detail({
      evidence: [ev({ id: "d1", provenanceType: "EXTERNAL_DOCUMENT", source: "party.external_document", subject: "PARTY_DOC:abc", mine: true, verificationStatus: "CLIENT_CLAIMED_UNVERIFIED", payload: { description: "Ảnh chụp tin nhắn", declaredSha256: "c".repeat(64), title: "Tin nhắn", fileName: "a.png", fileStored: false, hashStatus: "CLIENT_CLAIMED_UNVERIFIED", fileStorage: "DESIGN_REQUIRED" } })],
    });
    const [v] = M.evidenceViews(d);
    assert.equal(v.title, "Tài liệu do bạn khai");
    assert.deepEqual(v.badges.map((b) => b.label), [L.MINE_LABEL, L.OWN_DOC_UNVERIFIED]);
    assert.deepEqual(v.facts.map((f) => f.label), ["Tiêu đề", "Mô tả", "Tên tệp bạn ghi", "Mã sha256 bạn khai"]);
    assert.doesNotMatch(JSON.stringify(v), /DESIGN_REQUIRED|fileStored|PARTY_DOC/);
  });
  it("a stored-file key / path in a payload is never read", () => {
    const d = detail({ evidence: [ev({ source: "party.external_document_file", subject: "PARTY_FILE:x", mine: true, verificationStatus: "SERVER_VERIFIED", payload: { description: "d", storedFile: { key: "SECRET/KEY/123", sha256: "e".repeat(64) } } })] });
    assert.doesNotMatch(JSON.stringify(M.evidenceViews(d)), /SECRET|KEY\/123/);
  });
  it("system evidence: source wording from the provenance, times, no payload", () => {
    const [v] = M.evidenceViews(detail({ evidence: [ev({ provenanceType: "SERVER_OBSERVED", payload: { secret: "internal-only-value" } })] }));
    assert.equal(v.title, "Thông tin buổi tập");
    assert.equal(v.sourceLine, "Hệ thống ghi nhận trực tiếp");
    assert.equal(v.mine, false);
    assert.equal(v.badges.length, 0);
    assert.equal(v.facts.length, 0);
    assert.equal(v.times.length, 2);
    assert.doesNotMatch(JSON.stringify(v), /internal-only-value/);
  });
  it("gym check-in carries the caveat; a self-scanned one says it is the user's own scan", () => {
    const [v] = M.evidenceViews(detail({ evidence: [ev({ subject: "GYM_CHECK_INS_SELF_REPORTED", provenanceType: "SELF_REPORTED_SERVER_RECORDED", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" })] }));
    assert.equal(v.caveat, "Check-in phòng tập không chứng minh buổi dạy PT đã diễn ra.");
    assert.ok(v.badges.some((b) => /chưa xác minh/.test(b.label)));
  });
  it("an unreadable source says 'không đọc được nguồn' and that it is not proof of absence", () => {
    const [v] = M.evidenceViews(detail({ evidence: [ev({ provenanceType: "TECH_GAP", captureStatus: "UNAVAILABLE" })] }));
    assert.ok(v.badges.some((b) => b.label === "Không đọc được nguồn"));
    assert.match(v.caveat ?? "", /không phải bằng chứng về việc vắng mặt/);
  });
  it("shared (non-mine) party row says 'được chia sẻ cho bạn' and shows no payload details", () => {
    const [v] = M.evidenceViews(detail({ evidence: [ev({ source: "party.external_document", subject: "PARTY_DOC:z", mine: false, verificationStatus: "CLIENT_CLAIMED_UNVERIFIED", payload: { description: "nội dung bên kia" } })] }));
    assert.equal(v.title, "Tài liệu được chia sẻ cho bạn");
    assert.equal(v.facts.length, 0);
  });
  it("statements: oldest first, versions, 'mine' / role-recorded / shared, supplement reason", () => {
    const d = detail({
      statements: [
        st({ id: "b", version: 2, createdAt: "2026-11-02T04:00:00.000Z", supplementReason: "Có thêm ảnh", mine: true }),
        st({ id: "a", version: 1, createdAt: "2026-11-01T04:00:00.000Z", source: "LEGACY_FIELD", mine: false }),
        st({ id: "c", partyRole: "CLIENT", version: 1, createdAt: "2026-11-01T05:00:00.000Z", mine: false }),
      ],
    });
    const v = M.statementViews(d);
    assert.deepEqual(v.map((x) => x.id), ["a", "c", "b"]);
    assert.deepEqual(v.map((x) => x.who), [L.ROLE_RECORDED_LABEL, L.SHARED_LABEL, L.MINE_LABEL]);
    assert.equal(v[0].sourceLine, "Ghi nhận từ lúc khiếu nại ban đầu");
    assert.equal(v[2].heading, "Lời khai lần 2");
    assert.equal(v[2].supplementReason, "Có thêm ảnh");
    assert.equal(v[0].supplementReason, null);
  });
  it("accusations in party words", () => {
    const [a] = M.accusationViews(detail());
    assert.equal(a.who, "Khách hàng nêu");
    assert.equal(a.moves, "tiền");
  });
  it("money: group label only + the 'status, not confirmation' sentence; an amount in a label is dropped", () => {
    const m = M.moneyView({ group: "F1", groupLabel: "Đã ghi sổ đủ" });
    assert.equal(m.label, "Đã ghi sổ đủ");
    assert.match(m.note, /không phải xác nhận tiền đã về/);
    assert.match(m.note, /không hiển thị số tiền/);
    const leaky = M.moneyView({ group: "F3", groupLabel: "Còn thiếu 250.000 ₫ chưa trả" });
    assert.doesNotMatch(leaky.label, /\d/);
    assert.equal(leaky.label, "Còn phải thanh toán hoặc đối soát");
    assert.match(M.moneyView({ group: "UNAVAILABLE", groupLabel: "" }).label, /không đọc được sổ cái/);
    assert.match(M.moneyView(undefined).label, /Cần xác minh/);
  });
  it("header: canSubmit comes from the server flag only", () => {
    assert.equal(M.caseHeader(detail()).canSubmit, true);
    const d = detail();
    d.case = { ...d.case, canSubmit: false, status: "AWAITING_APPROVAL" };
    const h = M.caseHeader(d);
    assert.equal(h.canSubmit, false);
    assert.equal(h.statusLabel, "Đề xuất xử lý đang chờ phê duyệt");
  });
  it("case id from the path must be a UUID (anything else = not found without a request)", () => {
    assert.equal(M.parseCaseId(IDS.case), IDS.case);
    for (const bad of [undefined, "", "abc", "../admin", "11111111-1111-4111-8111-11111111111", "11111111-1111-4111-8111-1111111111111"]) assert.equal(M.parseCaseId(bad), null, String(bad));
  });
});
