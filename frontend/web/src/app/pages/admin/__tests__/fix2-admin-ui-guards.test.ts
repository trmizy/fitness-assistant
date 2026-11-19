/**
 * FIX2-ADMIN (15/11/2026) source guards for the small UI fixes (CODE AUDIT of the source; the behaviour was checked in a real browser - see the report).
 *   N14T-14 ledger cards at 390 | N14A-02 amenity name error | N14G-09 document accept 409 | Q5 admin lifecycle wiring | N14A-01 form wiring
 * Run: npx tsx --test src/app/pages/admin/__tests__/fix2-admin-ui-guards.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src/app", rel), "utf8");

describe("N14T-14: the transaction ledger has a stacked layout on phones", () => {
  const drawer = read("pages/admin/finance/transactions/TransactionDrawer.tsx");
  it("a card list below 640px and the table from 640px up, both fed by the same entries", () => {
    assert.match(drawer, /data-testid="admin-transaction-ledger-cards"[^>]*className="space-y-2 sm:hidden"/);
    assert.match(drawer, /className="hidden overflow-x-auto rounded-lg border border-adm-border sm:block"/);
    assert.match(drawer, /data-testid="admin-transaction-ledger"/);
  });
  it("every card shows the amount AND the balance before -> after (the column that used to be cut off)", () => {
    const cards = drawer.slice(drawer.indexOf("admin-transaction-ledger-cards"), drawer.indexOf('data-testid="admin-transaction-ledger"'));
    assert.match(cards, /formatMoneyExact\(e\.amount\)/);
    assert.match(cards, /formatMoneyExact\(e\.balanceBefore\)[\s\S]*formatMoneyExact\(e\.balanceAfter\)/);
  });
});

describe("N14A-02: an empty amenity name is reported under the name box", () => {
  const tab = read("pages/admin/listings/AmenityCatalogTab.tsx");
  it("inline error with role=alert, aria-invalid and focus on the name box", () => {
    assert.match(tab, /id="amenity-name-error"[^>]*role="alert"/);
    assert.match(tab, /aria-invalid=\{nameError \? true : undefined\}/);
    assert.match(tab, /document\.getElementById\("amenity-name"\)\?\.focus\(\)/);
  });
});

describe("N14G-09: accepting a document that is no longer pending", () => {
  const panel = read("pages/admin/AdminApplicationsPanel.tsx");
  it("shows a toast AND a note on the panel, and re-reads the application", () => {
    assert.match(panel, /DOCUMENT_NOT_PENDING_REVIEW/);
    assert.match(panel, /toast\.error\(text, \{ id: "admin-doc-accept-error" \}\)/);
    assert.match(panel, /data-testid="admin-application-doc-notice"/);
    const report = panel.slice(panel.indexOf("const reportFailure"), panel.indexOf("const view = async"));
    assert.match(report, /onChanged\(\)/);
  });
});

describe("Q5 / N14A-01: admin branch screens", () => {
  const page = read("pages/admin/AdminGymModeration.tsx");
  const edit = read("pages/admin/AdminGymBranchEdit.tsx");
  const life = read("pages/admin/AdminGymLifecycle.tsx");
  it("the all-branches card has the edit form, the Trạng thái menu and both status pills", () => {
    assert.match(page, /<AdminGymBranchEdit gym=\{g\}/);
    assert.match(page, /<AdminGymLifecycleMenu gym=\{g\}/);
    assert.match(page, /<GymOperationalPill status=\{operational\}/);
    assert.match(page, /admin-gym-closure-note/);
  });
  it("the old form that always sent `description` is gone", () => {
    assert.doesNotMatch(page, /gymEditForm/);
    assert.doesNotMatch(page, /updateGymMutation/);
  });
  it("the form sends only what validateGymEdit built and shows the reason box with a counter only for a changed description", () => {
    assert.match(edit, /save\.mutate\(check\.body\)/);
    assert.match(edit, /descriptionChanged && \(/);
    assert.match(edit, /admin-gym-edit-reason-count/);
    assert.match(edit, /Lý do sửa phần giới thiệu/);
  });
  it("every lifecycle action goes through a confirm dialog with a reason and an explained effect", () => {
    assert.match(life, /<ConfirmDialog/);
    assert.match(life, /description=\{meta\.effect\}/);
    assert.match(life, /adminService\.setGymLifecycle\(gym\.id, buildLifecycleBody\(meta, reason, reopenDate\)/);
    assert.match(life, /confirmDisabled=\{!!errors\.reason \|\| !!errors\.date\}/);
  });
});

describe("GYM_DEBT obligation kind (payment-service, FIX2-PAY)", () => {
  it("both admin label tables read it in Vietnamese", () => {
    assert.match(read("pages/admin/finance/transactions/transactionsLabels.ts"), /GYM_DEBT: "Phòng gym còn nợ nền tảng"/);
    assert.match(read("pages/admin/adminReconciliation.utils.ts"), /GYM_DEBT: "Phòng gym còn nợ nền tảng"/);
  });
});
