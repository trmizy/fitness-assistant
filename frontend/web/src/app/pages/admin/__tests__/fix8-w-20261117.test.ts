/**
 * FIX8-W (17/11/2026): supplement wording, reviewer picker without ids, vague 409. TEST FIXTURE: pure functions, no HTTP.
 * Run: npx tsx --test src/app/pages/admin/__tests__/fix8-w-20261117.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appealResultConsequence, EXECUTE_SUPPLEMENT_CONFIRM_NOTICE, gymOutcomeConsequence, proposalConsequence } from "../complaints/gymCaseLabels";
import { parseGymErrorBody } from "../complaints/gymCaseErrors";
import { parseAdminOptions } from "../disputes/actions/actionModel";

describe("1. approval wording follows the proposal outcome", () => {
  it("a supplement proposal never says 'hoàn gói hội viên đúng một lần'", () => {
    const t = proposalConsequence("MEM_TXN", "REFUND_APPEAL_SUPPLEMENT", "ESTABLISHED");
    assert.match(t, /PHẦN CHÊNH LỆCH/);
    assert.doesNotMatch(t, /hoàn gói hội viên đúng một lần/);
    assert.doesNotMatch(EXECUTE_SUPPLEMENT_CONFIRM_NOTICE, /hoàn gói hội viên đúng một lần/);
  });
  it("a plain refund proposal keeps its own refund wording; a no-money outcome says no money changes", () => {
    assert.match(proposalConsequence("MEM_TXN", "REFUND_TRANSACTION_ERROR", "ESTABLISHED"), /hoàn phần chưa dùng/);
    assert.match(proposalConsequence("MEM_TXN", "RESOLVE_UPHELD", "ESTABLISHED"), /Không có khoản tiền nào thay đổi/);
  });
  it("without a proposal outcome it falls back to the finding wording, and to empty with neither", () => {
    assert.match(proposalConsequence("MEM_TXN", null, "ESTABLISHED"), /hoàn gói hội viên đúng một lần/);
    assert.equal(proposalConsequence("MEM_TXN", null, null), "");
    assert.equal(gymOutcomeConsequence("REFUND_APPEAL_SUPPLEMENT").length > 0, true);
  });
  it("the appeal propose form's text depends on the chosen result", () => {
    assert.match(appealResultConsequence("OVERTURN_MEMBER"), /PHẦN CHÊNH LỆCH/);
    assert.match(appealResultConsequence("UPHOLD"), /Giữ nguyên/);
    assert.match(appealResultConsequence("OVERTURN_GYM"), /không trừ ví hội viên/);
    assert.doesNotMatch(appealResultConsequence(""), /hoàn gói hội viên đúng một lần/);
  });
  it("source: the approval form and the execute dialog no longer print the finding-level refund line for a supplement", () => {
    const d = readFileSync(new URL("../complaints/forms/DecisionForm.tsx", import.meta.url), "utf8");
    assert.match(d, /proposalConsequence\(detail\.case\.caseClass, proposal\.outcome/);
    assert.doesNotMatch(d, /findingConsequence\(/);
    const e = readFileSync(new URL("../complaints/forms/ExecutionPanel.tsx", import.meta.url), "utf8");
    assert.match(e, /supplement \? EXECUTE_SUPPLEMENT_CONFIRM_NOTICE/);
  });
});

describe("2. reviewer picker never shows an id", () => {
  const A = "f15e019f-390b-44fc-a6bf-7ff388b13891";
  const B = "a0000000-0000-4000-8000-000000000002";
  it("name only, no id fragment, when the directory has no email", () => {
    const o = parseAdminOptions([{ id: A, displayName: "QA N17M Client" }, { id: B, displayName: "Admin 2" }], "me");
    assert.deepEqual(o.map((x) => x.label), ["Admin 2", "QA N17M Client"]);
    for (const x of o) assert.doesNotMatch(x.label, /f15e019f|a0000000|\([0-9a-f]{8}\)/);
  });
  it("two admins with the same name get the email, else a stable ordinal (ordered by id)", () => {
    const same = parseAdminOptions([{ id: B, displayName: "Trùng Tên" }, { id: A, displayName: "Trùng Tên" }], "me");
    assert.deepEqual(same.map((x) => x.label).sort(), ["Trùng Tên · Quản trị viên 1", "Trùng Tên · Quản trị viên 2"]);
    assert.equal(same.find((x) => x.id === A)?.label, "Trùng Tên · Quản trị viên 2"); // A (f1..) sorts after B (a0..)
    assert.equal(same.find((x) => x.id === B)?.label, "Trùng Tên · Quản trị viên 1");
    const mail = parseAdminOptions([{ id: B, displayName: "Trùng Tên", email: "b@x.vn" }, { id: A, displayName: "Trùng Tên", email: "a@x.vn" }], "me");
    assert.deepEqual(mail.map((x) => x.label), ["Trùng Tên (a@x.vn)", "Trùng Tên (b@x.vn)"]);
  });
  it("source: AppealTab no longer renders shortRef(adm.id) in the picker", () => {
    const s = readFileSync(new URL("../disputes/workspace/tabs/AppealTab.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(s, /shortRef\(adm\.id\)/);
  });
});

describe("3. assigned appeal collapses the assign form behind 'Đổi người xét'", () => {
  const s = readFileSync(new URL("../disputes/workspace/tabs/AppealTab.tsx", import.meta.url), "utf8");
  it("the form is drawn only without a reviewer or after the explicit change button", () => {
    assert.match(s, /\(!item\.reviewerId \|\| reassignOpen\[item\.id\]\)/);
    assert.match(s, /Đổi người xét/);
    assert.match(s, /adm\.id !== item\.reviewerId/); // the current reviewer is not offered again
  });
});

describe("4. APPEAL_ASSESSMENT_REQUIRED says what happened and what to do", () => {
  it("names the cause and the next step, code unchanged", () => {
    const v = parseGymErrorBody(409, { error: { code: "APPEAL_ASSESSMENT_REQUIRED", message: "x" } });
    assert.equal(v.code, "APPEAL_ASSESSMENT_REQUIRED");
    assert.match(v.message, /chưa có đánh giá mới/);
    assert.match(v.message, /Khẳng định & đánh giá/);
  });
});
