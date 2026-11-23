/**
 * TEST FIXTURE (pure functions) + CODE AUDIT (source text) - G6 "Khiếu nại, Thương hiệu & nhân sự, Hồ sơ": the case list / detail model
 * (words, filters, timeline, 403/404/409/5xx, leave guard), the brand + staff model (tabs by permissions[], role and branch rules, exact
 * legacy bodies, server answers), the profile model (sections, payout is the owner's, password, answers) and the source audits (the case
 * screen has no decision / appeal / refund control, the two legacy forms are wrapped untouched, no role-name test, the invitation link is
 * never logged, flag-off routes are the legacy pages).
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/*.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { canOf } from "./permFixture";
import { canUseFeature } from "../../../utils/gymStaffRole";
import { activeNavIdForPath, flatNavFor, pageTitleForPath, scopeKindForPath } from "../../../components/layout/gym-owner/gymOwnerNav";
import {
  CASE_FILTERS,
  FILTER_LIMIT_NOTE,
  caseHref,
  caseProblem,
  caseRows,
  caseTimeline,
  dueOf,
  filterCounts,
  filterRows,
  hasTypedContent,
  listSummary,
  parseCaseFilter,
  rowsInScope,
  shouldAskBeforeLeaving as caseLeave,
  taskOf,
} from "../cases/casesModel";
import {
  EMPTY_INVITE,
  STAFF_ROLES,
  activeStaff,
  brandDirty,
  brandFailure,
  brandFormFrom,
  brandProblems,
  brandTabsFor,
  brandUpdatePayload,
  inviteAgeText,
  inviteDirty,
  inviteIsOld,
  invitePayload,
  inviteProblems,
  logoProblem,
  nameChanged,
  pendingInvites,
  resolveBrandTab,
  revokeAccountCopy,
  revokeInviteCopy,
  scopeOf,
  shouldAskBeforeLeaving as brandLeave,
  staffFailure,
  staffName,
  toggleBranch,
} from "../brand/brandModel";
import {
  branchStatusWord,
  hasPayoutOnFile,
  parseSection,
  passwordState,
  payoutDirty,
  payoutMissingField,
  payoutPayload,
  payoutValid,
  phoneState,
  profileFailure,
  profileHref,
  shouldAskBeforeLeaving as profileLeave,
  showBrandLink,
  showPayout,
} from "../profile/profileModel";

const here = dirname(fileURLToPath(import.meta.url));
const feat = (...p: string[]) => resolve(here, "..", ...p);
const src = (f: string) => readFileSync(f, "utf8");
const srcDir = (d: string) => readdirSync(feat(d)).filter((f) => /\.tsx?$/.test(f)).map((f) => ({ f, text: src(feat(d, f)) }));
const http = (status: number, error?: Record<string, unknown>) => ({ response: { status, data: { success: false, error: error ?? {} } } });

// --------------------------------------------------------------------------------------------------------------------------------- Khiếu nại
describe("G6 Khiếu nại: list rows", () => {
  const items = [
    { id: "c1", gymId: "g1", issueType: "CLEANLINESS", progress: "Đã tiếp nhận", canSubmit: true, awaitingYou: false, respondBy: null, createdAt: "2026-11-01T00:00:00Z" },
    { id: "c2", gymId: "g2", issueType: "SAFETY", progress: "Gymini đang xem xét", canSubmit: false, awaitingYou: false, respondBy: null, createdAt: "2026-11-05T00:00:00Z" },
    { id: "c3", gymId: "g1", issueType: "OTHER", progress: "Chờ phòng tập giải trình", canSubmit: true, awaitingYou: true, respondBy: "2026-11-10T00:00:00Z", createdAt: "2026-10-20T00:00:00Z" },
    { id: "c4", gymId: "gX", issueType: "WEIRD_ENUM", progress: "   ", canSubmit: false, respondBy: null, createdAt: "2026-11-07T00:00:00Z" },
  ];
  const gyms = [{ id: "g1", name: "Gymini Quận 1" }, { id: "g2", name: "Gymini Quận 7" }];
  const rows = caseRows(items, gyms);

  it("the gym's task comes from the two flags the server sends, in words", () => {
    assert.deepEqual(taskOf({ awaitingYou: true, canSubmit: true }), { kind: "awaiting", text: "Cần phòng tập phản hồi", tone: "warn" });
    assert.equal(taskOf({ awaitingYou: false, canSubmit: true }).kind, "open");
    assert.equal(taskOf({ canSubmit: false }).kind, "none");
  });
  it("rows: awaiting first, then newest; type in Vietnamese; the server's progress sentence, a fallback for an empty one; unknown branch has no name", () => {
    assert.deepEqual(rows.map((r) => r.id), ["c3", "c4", "c2", "c1"]);
    assert.equal(rows.find((r) => r.id === "c1")!.typeText.includes("CLEANLINESS"), false);
    assert.equal(rows.find((r) => r.id === "c4")!.progress, "Đang xử lý");
    assert.equal(rows.find((r) => r.id === "c4")!.gymName, null);
    assert.equal(rows.find((r) => r.id === "c1")!.gymName, "Gymini Quận 1");
    for (const r of rows) assert.equal(/[A-Z]{3,}_[A-Z_]+/.test(`${r.typeText} ${r.progress} ${r.task.text}`), false, "no raw enum");
  });
  it("scope: one branch keeps only its cases, ALL keeps what the server returned", () => {
    assert.deepEqual(rowsInScope(rows, "g1").map((r) => r.id).sort(), ["c1", "c3"]);
    assert.equal(rowsInScope(rows, "ALL").length, 4);
  });
  it("filters cut only the loaded list; counts add up; an unknown value falls back to all", () => {
    assert.deepEqual(filterCounts(rows), { all: 4, awaiting: 1, open: 1, closed: 2 });
    assert.deepEqual(filterRows(rows, "awaiting").map((r) => r.id), ["c3"]);
    assert.deepEqual(filterRows(rows, "closed").map((r) => r.id).sort(), ["c2", "c4"]);
    assert.equal(parseCaseFilter("nope"), "all");
    for (const f of CASE_FILTERS) assert.equal(parseCaseFilter(f), f);
    assert.match(FILTER_LIMIT_NOTE, /không có bộ lọc trạng thái/);
    assert.match(FILTER_LIMIT_NOTE, /chỉ lọc trong danh sách đã tải/);
    assert.match(listSummary(5, 2, "Gymini Quận 1", "awaiting"), /Cần phản hồi/);
  });
  it("deadline: none, open, overdue (the server keeps the case open either way)", () => {
    assert.equal(dueOf(null, Date.now()).state, "none");
    assert.equal(dueOf("2099-01-01T00:00:00Z", Date.now()).state, "open");
    const o = dueOf("2020-01-01T00:00:00Z", Date.now());
    assert.equal(o.state, "overdue");
    assert.match(o.text, /Quá hạn/);
  });
  it("deep link keeps the path and the branch", () => {
    assert.equal(caseHref("a b", "g1"), "/gym-owner/complaint-cases/a%20b?gymId=g1");
    assert.equal(caseHref("c1", "ALL"), "/gym-owner/complaint-cases/c1");
    assert.equal(caseHref(null, null), "/gym-owner/complaint-cases");
  });
});

describe("G6 Khiếu nại: detail", () => {
  const detail = {
    moreInfo: { note: "Cần ảnh", askedAt: "2026-11-03T00:00:00Z", askedParties: ["GYM" as const], dueAt: "2026-11-12T00:00:00Z" },
    case: { id: "c1", gymId: "g1", progress: "Chờ phòng tập giải trình", createdAt: "2026-11-01T00:00:00Z", canSubmit: true, respondBy: "2026-11-12T00:00:00Z" },
    complaint: { issueType: "CLEANLINESS", description: "Sàn bẩn" },
    evidence: [{ id: "e1", source: "PARTY_DOCUMENT", subject: "x", capturedAt: "2026-11-04T00:00:00Z", payload: { description: "Biên bản vệ sinh" }, verificationStatus: "SELF_DECLARED", verificationLabel: "Tự khai", mine: true }],
    statements: [{ id: "s1", partyRole: "GYM", version: 1, text: "Chúng tôi đã dọn", supplementReason: null, createdAt: "2026-11-05T00:00:00Z", mine: true }],
  };
  it("timeline is ordered by time, ends with the present progress, never invents a result", () => {
    const t = caseTimeline(detail as never);
    assert.deepEqual(t.map((x) => x.key), ["opened", "more", "e-e1", "s-s1", "now"]);
    assert.equal(t[t.length - 1].text, "Chờ phòng tập giải trình");
    assert.equal(t[t.length - 1].done, false);
    assert.equal(t.find((x) => x.key === "e-e1")!.title, "Phòng tập khai báo bằng chứng");
    assert.equal(t.find((x) => x.key === "s-s1")!.title, "Phòng tập gửi giải trình");
  });
  it("403 / 404 / 409 / 500 / no answer: one Vietnamese sentence each, a retry only where it can help, never a code", () => {
    const f403 = caseProblem(http(403, { code: "FORBIDDEN" }), "detail");
    assert.equal(f403.kind, "forbidden");
    assert.equal(f403.retry, false);
    const f404 = caseProblem(http(404, { code: "CASE_NOT_FOUND" }), "detail");
    assert.equal(f404.kind, "notFound");
    const f409 = caseProblem(http(409, { code: "CASE_VERSION_CONFLICT" }), "detail");
    assert.equal(f409.kind, "conflict");
    assert.equal(f409.retry, true);
    const f500 = caseProblem(http(500, { code: "INTERNAL_ERROR" }), "detail");
    assert.equal(f500.kind, "server");
    assert.equal(f500.retry, true);
    const net = caseProblem({ message: "Network Error" }, "list");
    assert.equal(net.kind, "network");
    assert.equal(caseProblem(http(401), "list").kind, "auth");
    for (const p of [f403, f404, f409, f500, net]) assert.equal(/[A-Z]{4,}_[A-Z_]+/.test(`${p.title} ${p.body}`), false, "no raw code");
    assert.match(caseProblem(http(403), "list").body, /Chưa kết luận/);
  });
  it("leaving with typed text asks: other page, other case, other branch; the same case with the same branch does not", () => {
    const at = (pathname: string, search = "") => ({ pathname, search });
    assert.equal(caseLeave({ dirty: false, from: at("/gym-owner/complaint-cases/c1"), to: at("/gym-owner/finance") }), false);
    assert.equal(caseLeave({ dirty: true, from: at("/gym-owner/complaint-cases/c1"), to: at("/gym-owner/finance") }), true);
    assert.equal(caseLeave({ dirty: true, from: at("/gym-owner/complaint-cases/c1"), to: at("/gym-owner/complaint-cases") }), true);
    assert.equal(caseLeave({ dirty: true, from: at("/gym-owner/complaint-cases/c1", "?gymId=g1"), to: at("/gym-owner/complaint-cases/c1", "?gymId=g2") }), true);
    assert.equal(caseLeave({ dirty: true, from: at("/gym-owner/complaint-cases/c1", "?gymId=g1"), to: at("/gym-owner/complaint-cases/c1/", "?gymId=g1") }), false);
  });
  it("typed content is read from the wrapped forms' controls, at the moment of leaving", () => {
    const root = (values: string[]) => ({ querySelectorAll: () => values.map((value) => ({ value })) }) as never;
    assert.equal(hasTypedContent(null), false);
    assert.equal(hasTypedContent(root([])), false);
    assert.equal(hasTypedContent(root(["", "   "])), false);
    assert.equal(hasTypedContent(root(["", "Giải trình dở"])), true);
  });
});

describe("G6 Khiếu nại: source audit (CODE AUDIT)", () => {
  const files = srcDir("cases");
  const all = files.map((x) => x.text).join("\n");
  it("only the owner reads and the two owner writes exist; no decision, appeal, refund, execute, assign, share control", () => {
    const calls = [...all.matchAll(/gymCaseApi\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(calls)].sort(), ["getOwner", "listOwner", "submitOwnerEvidence", "submitOwnerExplanation"]);
    assert.equal(/submitMemberAppeal|GymMemberAppealForm|\.decide\(|\.execute\(|reconcile|requestMore|proposeReplacement/.test(all), false);
  });
  it("the two legacy forms are wrapped, imported from the legacy file, with the owner submit functions", () => {
    const drawer = files.find((x) => x.f === "CaseDrawer.tsx")!.text;
    assert.match(drawer, /from "\.\.\/\.\.\/\.\.\/pages\/complaints\/GymMemberForms"/);
    assert.match(drawer, /<GymStatementForm[^>]*party="gym"[^>]*submit=\{gymCaseApi\.submitOwnerExplanation\}/);
    assert.match(drawer, /<GymDocumentForm[^>]*submit=\{gymCaseApi\.submitOwnerEvidence\}/);
  });
  it("the legacy forms file keeps its own state (not forked into the new feature)", () => {
    assert.equal(files.some((x) => /function GymStatementForm|function GymDocumentForm/.test(x.text)), false);
  });
  it("no polling: the list and the detail never refetch by interval / focus (every read writes an access log)", () => {
    assert.equal(/refetchInterval:\s*[1-9]/.test(all), false);
    assert.match(all, /GYM_QUERY_OPTIONS/);
  });
  it("no role-name decision, no console output", () => {
    assert.equal(/role\s*===\s*["'](OWNER|MANAGER|RECEPTIONIST|ACCOUNTANT)/.test(all), false);
    assert.equal(/console\./.test(all), false);
  });
});

// --------------------------------------------------------------------------------------------------------------------------------- Thương hiệu
describe("G6 Thương hiệu & nhân sự: tabs and guards", () => {
  it("tabs come from permissions[]: owner both, manager and accountant read the brand, receptionist none, unknown nothing", () => {
    assert.deepEqual(brandTabsFor(canOf("OWNER")).map((t) => [t.id, !!t.readOnly]), [["info", false], ["staff", false]]);
    for (const r of ["MANAGER", "ACCOUNTANT"] as const) assert.deepEqual(brandTabsFor(canOf(r)).map((t) => [t.id, !!t.readOnly]), [["info", true]], r);
    assert.deepEqual(brandTabsFor(canOf("RECEPTIONIST")), []);
    assert.deepEqual(brandTabsFor(canOf(undefined)), []);
  });
  it("resolve: a staff tab nobody may open falls back to info; no tabs = forbidden", () => {
    assert.equal(resolveBrandTab("staff", canOf("OWNER")), "staff");
    assert.equal(resolveBrandTab("staff", canOf("MANAGER")), "info");
    assert.equal(resolveBrandTab("zzz", canOf("OWNER")), "info");
    assert.equal(resolveBrandTab("info", canOf("RECEPTIONIST")), null);
  });
  it("route guard feature 'brand' = brand.view holders (O, M, A); 'staff' stays owner only", () => {
    assert.deepEqual((["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as const).filter((r) => canUseFeature(r, "brand")), ["OWNER", "MANAGER", "ACCOUNTANT"]);
    assert.deepEqual((["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"] as const).filter((r) => canUseFeature(r, "staff")), ["OWNER"]);
  });
  it("nav: the owner entry is 'Thương hiệu' -> /gym-owner/brand; /managers still has a title, an active entry and the brand scope", () => {
    const staff = flatNavFor("OWNER").find((i) => i.id === "staff");
    assert.equal(staff?.label, "Thương hiệu");
    assert.equal(staff?.to, "/gym-owner/brand");
    assert.equal(pageTitleForPath("/gym-owner/brand"), "Thương hiệu");
    assert.equal(pageTitleForPath("/gym-owner/managers"), "Thương hiệu");
    assert.equal(activeNavIdForPath("/gym-owner/brand"), "staff");
    assert.equal(activeNavIdForPath("/gym-owner/managers"), "staff");
    assert.equal(scopeKindForPath("/gym-owner/brand"), "brand");
    assert.equal(scopeKindForPath("/gym-owner/managers"), "brand");
    assert.equal(flatNavFor("MANAGER").some((i) => i.id === "staff"), false);
  });
});

describe("G6 Nhân sự: roles, branches, exact legacy body", () => {
  it("role rules: manager and receptionist need a branch, accountant empty = whole brand; the rule is said before picking", () => {
    assert.equal(STAFF_ROLES.MANAGER.needsBranch, true);
    assert.equal(STAFF_ROLES.RECEPTIONIST.needsBranch, true);
    assert.equal(STAFF_ROLES.ACCOUNTANT.needsBranch, false);
    assert.match(STAFF_ROLES.MANAGER.scopeRule, /ít nhất 1 chi nhánh/);
    assert.match(STAFF_ROLES.ACCOUNTANT.scopeRule, /toàn thương hiệu/);
  });
  it("invite validation: email shape; M and R without a branch are refused; A with none is fine", () => {
    assert.deepEqual(inviteProblems({ ...EMPTY_INVITE, email: "" }), { email: "Nhập email của nhân sự.", branches: "Quản lý phải được gán ít nhất 1 chi nhánh." });
    assert.match(inviteProblems({ role: "MANAGER", email: "not-an-email", scopedGymIds: ["g1"] }).email ?? "", /chưa hợp lệ/);
    assert.deepEqual(inviteProblems({ role: "MANAGER", email: "a@b.vn", scopedGymIds: ["g1"] }), {});
    assert.equal(inviteProblems({ role: "RECEPTIONIST", email: "a@b.vn", scopedGymIds: [] }).branches, "Lễ tân phải được gán ít nhất 1 chi nhánh.");
    assert.deepEqual(inviteProblems({ role: "ACCOUNTANT", email: "a@b.vn", scopedGymIds: [] }), {});
  });
  it("invite body is exactly the legacy one: {email (trimmed), role, scopedGymIds}", () => {
    assert.deepEqual(invitePayload({ role: "ACCOUNTANT", email: "  ke.toan@x.vn ", scopedGymIds: [] }), { email: "ke.toan@x.vn", role: "ACCOUNTANT", scopedGymIds: [] });
    assert.deepEqual(Object.keys(invitePayload({ role: "MANAGER", email: "a@b.vn", scopedGymIds: ["g1"] })).sort(), ["email", "role", "scopedGymIds"]);
    assert.deepEqual(toggleBranch(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleBranch(["a", "b"], "a"), ["b"]);
    assert.equal(inviteDirty(EMPTY_INVITE), false);
    assert.equal(inviteDirty({ ...EMPTY_INVITE, email: "a" }), true);
  });
  it("lists: not-owner + ACTIVE accounts; PENDING invitations only; scope text (accountant empty = whole brand, manager empty = unassigned)", () => {
    const accounts = [{ id: "1", role: "OWNER", status: "ACTIVE" }, { id: "2", role: "MANAGER", status: "ACTIVE", scopedGymIds: ["g1"] }, { id: "3", role: "RECEPTIONIST", status: "REVOKED" }, { id: "4", role: "ACCOUNTANT", status: "ACTIVE", scopedGymIds: [] }];
    assert.deepEqual(activeStaff(accounts).map((a) => a.id), ["2", "4"]);
    assert.deepEqual(pendingInvites([{ id: "i1", status: "PENDING", role: "MANAGER" }, { id: "i2", status: "ACCEPTED", role: "MANAGER" }, { id: "i3", status: "PENDING", role: "OWNER" }]).map((i) => i.id), ["i1"]);
    const gyms = [{ id: "g1", name: "Gymini Quận 1" }];
    assert.deepEqual(scopeOf("ACCOUNTANT", [], gyms), { kind: "all", names: [], text: "Toàn thương hiệu" });
    assert.equal(scopeOf("MANAGER", [], gyms).kind, "none");
    assert.deepEqual(scopeOf("MANAGER", ["g1", "gz"], gyms).names, [{ id: "g1", name: "Gymini Quận 1" }, { id: "gz", name: "Chi nhánh khác" }]);
    assert.equal(staffName({ id: "x", identity: { firstName: "An", lastName: "Lê", email: "a@b.vn" } }), "An Lê");
    assert.equal(staffName({ id: "x", identity: { email: "a@b.vn" } }), "a@b.vn");
  });
  it("invitation age in words; older than a week is flagged", () => {
    const now = new Date("2026-11-23T00:00:00Z").getTime();
    assert.equal(inviteAgeText("2026-11-23T00:00:00Z", now), "Mời hôm nay");
    assert.equal(inviteAgeText("2026-11-20T00:00:00Z", now), "Đã mời 3 ngày trước");
    assert.equal(inviteIsOld("2026-11-10T00:00:00Z", now), true);
    assert.equal(inviteIsOld("2026-11-20T00:00:00Z", now), false);
  });
  it("revoke dialogs name the consequence", () => {
    assert.match(revokeAccountCopy("An Lê", "MANAGER").body, /không còn truy cập được/);
    assert.match(revokeAccountCopy("An Lê", "MANAGER").body, /không hoàn tác/);
    assert.match(revokeInviteCopy("a@b.vn").title, /a@b\.vn/);
  });
  it("server answers: 400 / 403 / 404 / 409 / 5xx / no answer in Vietnamese; unclear only when the outcome is unknown; no raw code", () => {
    assert.equal(staffFailure(http(403, { code: "OWNER_ROLE_REQUIRED" }), "invite").unclear, false);
    assert.match(staffFailure(http(403), "invite").text, /Chỉ chủ phòng tập/);
    assert.match(staffFailure(http(404), "revokeAccount").text, /Không tìm thấy tài khoản/);
    assert.match(staffFailure(http(404), "resend").text, /Không tìm thấy lời mời/);
    assert.match(staffFailure(http(409, { code: "X", message: "Email này đã có lời mời đang chờ" }), "invite").text, /Email này đã có lời mời/);
    assert.match(staffFailure(http(409, { code: "ERR_CONFLICT", message: "Conflict" }), "invite").text, /Email này đã có lời mời đang chờ hoặc đã là nhân sự/);
    assert.match(staffFailure(http(400, { message: "Thông tin sai" }), "invite").text, /Thông tin sai/);
    const f500 = staffFailure(http(500), "invite");
    assert.equal(f500.unclear, true);
    assert.match(f500.text, /chưa rõ/);
    assert.equal(staffFailure({ message: "Network Error" }, "invite").unclear, true);
    for (const f of [staffFailure(http(409, { code: "ERR_CONFLICT" }), "invite"), f500]) assert.equal(/[A-Z]{4,}_[A-Z_]+/.test(f.text), false);
  });
});

describe("G6 Thông tin thương hiệu: exact legacy body", () => {
  const brand = { id: "b1", name: "Fit", approvedName: "Fit Club", pendingName: null, description: "Mô tả", facebookUrl: "https://fb.com/x", instagramUrl: null, tiktokUrl: null, youtubeUrl: null } as never;
  it("the form starts from the server's values and is dirty only when something changed", () => {
    const f = brandFormFrom(brand);
    assert.equal(f.name, "Fit Club");
    assert.equal(f.instagramUrl, "");
    assert.equal(brandDirty(brand, f), false);
    assert.equal(brandDirty(brand, { ...f, description: "Khác" }), true);
    assert.equal(brandDirty(brand, { ...f, tiktokUrl: "https://t.co/1" }), true);
  });
  it("the name is sent ONLY when it really changed (a rename needs Gymini's approval); description and links are always sent, trimmed", () => {
    const f = brandFormFrom(brand);
    assert.equal(nameChanged(brand, f), false);
    const same = brandUpdatePayload(brand, { ...f, description: " Mô tả mới " });
    assert.equal("name" in same, false);
    assert.equal(same.description, "Mô tả mới");
    assert.deepEqual(Object.keys(same).sort(), ["description", "facebookUrl", "instagramUrl", "tiktokUrl", "youtubeUrl"]);
    assert.equal(brandUpdatePayload(brand, { ...f, name: " Tên Mới " }).name, "Tên Mới");
    // a pending rename is the current name of the form: retyping it does not send it again
    const pending = { ...(brand as object), pendingName: "Tên chờ duyệt" } as never;
    assert.equal(brandFormFrom(pending).name, "Tên chờ duyệt");
    assert.equal("name" in brandUpdatePayload(pending, brandFormFrom(pending)), false);
  });
  it("validation and the logo checks of the legacy uploader", () => {
    const f = brandFormFrom(brand);
    assert.deepEqual(brandProblems({ ...f, name: "  " }), { name: "Nhập tên thương hiệu." });
    assert.match(brandProblems({ ...f, description: "x".repeat(301) }).description ?? "", /tối đa 300/);
    assert.equal(logoProblem({ type: "image/png", size: 1000 }), null);
    assert.match(logoProblem({ type: "image/gif", size: 1000 }) ?? "", /Định dạng/);
    assert.match(logoProblem({ type: "image/png", size: 11 * 1024 * 1024 }) ?? "", /quá lớn/);
    assert.equal(logoProblem({ type: "image/png", size: 0 }), "Tệp rỗng.");
  });
  it("answers: 403 / 404 / 409 / 400 / 5xx / no answer; unclear only when the outcome is unknown", () => {
    assert.match(brandFailure(http(403), "save").text, /Chỉ chủ phòng tập/);
    assert.equal(brandFailure(http(500), "save").unclear, true);
    assert.equal(brandFailure(http(400, { message: "Link không hợp lệ" }), "save").text, "Link không hợp lệ");
    assert.equal(brandFailure(http(409), "save").unclear, false);
    assert.equal(brandFailure({}, "create").unclear, true);
  });
  it("leaving with typed input asks: another page or the other tab", () => {
    const at = (pathname: string, search = "") => ({ pathname, search });
    assert.equal(brandLeave({ dirty: true, from: at("/gym-owner/brand"), to: at("/gym-owner/brand", "?tab=staff") }), true);
    assert.equal(brandLeave({ dirty: true, from: at("/gym-owner/brand", "?tab=staff"), to: at("/gym-owner/finance") }), true);
    assert.equal(brandLeave({ dirty: false, from: at("/gym-owner/brand"), to: at("/gym-owner/finance") }), false);
    assert.equal(brandLeave({ dirty: true, from: at("/gym-owner/brand", "?tab=info"), to: at("/gym-owner/brand", "?tab=info") }), false);
  });
});

describe("G6 Thương hiệu: source audit (CODE AUDIT)", () => {
  const files = srcDir("brand");
  const all = files.map((x) => x.text).join("\n");
  it("same services as the legacy page", () => {
    for (const fn of ["listPartnerAccounts", "listPartnerInvitations", "inviteManager", "resendManagerInvitation", "revokeManagerInvitation", "revokePartnerAccount", "createBrand", "updateBrand", "listOwnedBrands"]) {
      assert.match(all, new RegExp(`gymService\\.${fn}\\(`), fn);
    }
    assert.match(all, /uploadApplicationFile\(file, \{ kind: "LOGO" \}/);
  });
  it("the invitation link is shown only in the 'created' dialog and copied; it is never logged", () => {
    assert.equal(/console\./.test(all), false);
    assert.equal((all.match(/inviteLink/g) ?? []).length > 0, true);
    assert.equal(/localStorage|sessionStorage/.test(all), false);
  });
  it("there is no role / branch edit call (the API has none) and no role-name decision", () => {
    assert.equal(/updatePartnerAccount|changeRole|updateAccountRole|patchPartnerAccount/.test(all), false);
    assert.equal(/role\s*===\s*["'](OWNER|MANAGER|RECEPTIONIST|ACCOUNTANT)/.test(all), false);
  });
  it("every revoke goes through a confirm dialog that names the consequence", () => {
    const staff = files.find((x) => x.f === "StaffTab.tsx")!.text;
    assert.match(staff, /revokeAccountCopy\(/);
    assert.match(staff, /revokeInviteCopy\(/);
    assert.match(staff, /testId="go-staff-revoke"/);
  });
  it("Chi nhánh keeps a link, not the brand editor: no rename form left on the branch page", () => {
    const branches = src(feat("branches", "BranchesPage.tsx"));
    assert.equal(/updateBrand|brand-rename-input|function BrandRow/.test(branches), false);
    assert.match(branches, /go-brand-open/);
    assert.match(branches, /createBrand/); // the first-run naming dialog (gate of "Thêm chi nhánh") stays
  });
});

// --------------------------------------------------------------------------------------------------------------------------------- Hồ sơ
describe("G6 Hồ sơ: model", () => {
  it("?section= is recognised, anything else is ignored; the payout link of the withdrawal dialog uses it", () => {
    assert.equal(parseSection("payout"), "payout");
    assert.equal(parseSection("password"), "password");
    assert.equal(parseSection("x"), null);
    assert.equal(parseSection(null), null);
    assert.equal(profileHref("payout"), "/gym-owner/profile?section=payout");
    assert.equal(profileHref(), "/gym-owner/profile");
    assert.match(src(feat("finance", "WithdrawDialog.tsx")), /to="\/gym-owner\/profile\?section=payout"/);
  });
  it("the payout account is the owner's: finance.withdraw AND the server sent a payout object; accountant / manager / unknown never", () => {
    const payout = { bankName: "VCB", accountNumber: "1", accountHolder: "A" };
    assert.equal(showPayout(canOf("OWNER"), payout), true);
    assert.equal(showPayout(canOf("OWNER"), null), false);
    for (const r of ["MANAGER", "RECEPTIONIST", "ACCOUNTANT", undefined] as const) assert.equal(showPayout(canOf(r), payout), false, String(r));
    assert.equal(showBrandLink(canOf("ACCOUNTANT")), true);
    assert.equal(showBrandLink(canOf("RECEPTIONIST")), false);
  });
  it("phone: dirty / valid / the sentence only when something wrong is typed", () => {
    assert.deepEqual(phoneState("0901 234 567", "0901 234 567"), { dirty: false, valid: true, problem: null });
    assert.equal(phoneState("0901234567", "").dirty, true);
    assert.match(phoneState("abc", "").problem ?? "", /chưa hợp lệ/);
    assert.equal(phoneState("", "0901234567").problem, null);
  });
  it("payout: exact legacy body, trimmed, all three fields required", () => {
    const saved = { bankName: "VCB", accountNumber: "123", accountHolder: "AN" };
    assert.equal(payoutDirty(saved, { bankName: "VCB", accountNumber: "123", accountHolder: "AN" }), false);
    assert.equal(payoutDirty(saved, { bankName: "VCB", accountNumber: "124", accountHolder: "AN" }), true);
    assert.equal(payoutValid({ bankName: "", accountNumber: "1", accountHolder: "A" }), false);
    assert.equal(payoutMissingField({ bankName: "VCB", accountNumber: "", accountHolder: "A" }), "Nhập số tài khoản.");
    assert.deepEqual(payoutPayload({ bankName: " VCB ", accountNumber: " 1 ", accountHolder: " A " }), { bankName: "VCB", accountNumber: "1", accountHolder: "A" });
    assert.equal(hasPayoutOnFile({ bankName: null, accountNumber: null, accountHolder: null }), false);
    assert.equal(hasPayoutOnFile(saved), true);
  });
  it("password: 8 characters, the two new entries match, the current one is required", () => {
    assert.equal(passwordState("", "", "").anyTyped, false);
    assert.equal(passwordState("old", "short", "short").canSubmit, false);
    assert.equal(passwordState("old", "short", "short").tooShort, true);
    assert.equal(passwordState("old", "longenough1", "longenough2").mismatch, true);
    assert.equal(passwordState("", "longenough1", "longenough1").canSubmit, false);
    assert.equal(passwordState("old", "longenough1", "longenough1").canSubmit, true);
  });
  it("answers of the two saves: 400 / 403 / 404 / 409 / 5xx / no answer", () => {
    assert.match(profileFailure(http(403), "payout").text, /Chỉ chủ phòng tập/);
    assert.match(profileFailure(http(404), "phone").text, /Không tìm thấy hồ sơ đối tác/);
    assert.match(profileFailure(http(400), "phone").text, /Số điện thoại chưa hợp lệ/);
    assert.equal(profileFailure(http(409), "payout").unclear, false);
    assert.equal(profileFailure(http(500), "payout").unclear, true);
    assert.equal(profileFailure({ message: "Network Error" }, "phone").unclear, true);
    for (const f of [profileFailure(http(409, { code: "ERR_X" }), "payout"), profileFailure(http(500), "phone")]) assert.equal(/[A-Z]{4,}_[A-Z_]+/.test(f.text), false);
  });
  it("leaving with something typed asks only when the page changes; branch statuses are words", () => {
    assert.equal(profileLeave({ dirty: true, from: { pathname: "/gym-owner/profile" }, to: { pathname: "/gym-owner/finance" } }), true);
    assert.equal(profileLeave({ dirty: true, from: { pathname: "/gym-owner/profile" }, to: { pathname: "/gym-owner/profile/" } }), false);
    assert.equal(profileLeave({ dirty: false, from: { pathname: "/gym-owner/profile" }, to: { pathname: "/gym-owner/finance" } }), false);
    assert.equal(branchStatusWord("APPROVED"), "Đang hiển thị");
    assert.equal(branchStatusWord("WHATEVER"), "Chưa rõ");
  });
});

describe("G6 Hồ sơ: source audit (CODE AUDIT)", () => {
  const files = srcDir("profile");
  const all = files.map((x) => x.text).join("\n");
  it("same calls as the legacy page", () => {
    for (const call of ["submitOnboardingContact", "submitOnboardingPayout", "authService.changePassword", "getOnboardingStatus"]) assert.match(all, new RegExp(call), call);
  });
  it("no role-name decision, no OWNER fallback, no console output, nothing stored in the browser", () => {
    assert.equal(/role\s*===\s*["'](OWNER|MANAGER|RECEPTIONIST|ACCOUNTANT)/.test(all), false);
    assert.equal(/\?\?\s*["']OWNER["']|\|\|\s*["']OWNER["']/.test(all), false);
    assert.equal(/console\.|localStorage|sessionStorage/.test(all), false);
  });
  it("the payout block says it is the source of every withdrawal", () => {
    assert.match(all, /PAYOUT_SOURCE_NOTE/);
    const model = files.find((x) => x.f === "profileModel.ts")!.text;
    assert.match(model, /lệnh rút tiền của mọi chi nhánh/);
  });
});

describe("G6 routes (CODE AUDIT)", () => {
  const routes = src(resolve(here, "..", "..", "..", "routes.tsx"));
  it("flag on: ONE case route with an optional :caseId; flag off: the two legacy pages", () => {
    assert.match(routes, /isGymOwnerV2Enabled\(\)\s*\?\s*\[\{ path: "complaint-cases\/:caseId\?"[^\n]*<CasesPage \/>/);
    assert.match(routes, /\[\{ path: "complaint-cases", element: <RequireStaffFeature feature="complaintCases"><GymComplaintCasesPage \/>/);
    assert.match(routes, /\{ path: "complaint-cases\/:caseId", element: <RequireStaffFeature feature="complaintCases"><GymComplaintCasePage \/>/);
  });
  it("flag on: /brand is V2-only behind feature 'brand'; /managers redirects behind the unchanged owner guard; flag off: the legacy page", () => {
    assert.match(routes, /isGymOwnerV2Enabled\(\) \? \[\{ path: "brand", element: <RequireStaffFeature feature="brand"><BrandPage \/>/);
    assert.match(routes, /\{ path: "managers", element: <RequireStaffFeature feature="staff"><Navigate to="\/gym-owner\/brand\?tab=staff" replace \/>/);
    assert.match(routes, /: \{ path: "managers", element: <RequireStaffFeature feature="staff"><ManageManagersPage \/>/);
  });
  it("profile: V2 page behind the flag, the legacy page otherwise, same guard", () => {
    assert.match(routes, /feature="profile">\{isGymOwnerV2Enabled\(\) \? <GymOwnerProfileV2Page \/> : <GymOwnerProfilePage \/>\}/);
  });
});
