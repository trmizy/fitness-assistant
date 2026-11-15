/**
 * FIX2-MODAL (15/11/2026) - source guards for the shared accessible overlay layer (CODE AUDIT of the source; the behaviour -
 * Esc, focus in/return, Tab trap, scroll lock, 40px close - is checked in a real browser, see the report).
 *   N14T-01/02/04 hand-rolled overlays -> <Modal> | N14T-06 40px targets | N14T-07 Vietnamese sr-only | N14T-08 names / tabs
 * Run: npx tsx --test src/app/components/ui/__tests__/modal-overlay.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src/app", rel), "utf8");

describe("shared <Modal> guarantees", () => {
  const modal = read("components/ui/Modal.tsx");
  it("is built on the Radix dialog primitive (focus trap, scroll lock, aria-hidden background, Esc, focus return)", () => {
    assert.match(modal, /from "@radix-ui\/react-dialog"/);
    assert.match(modal, /DialogPrimitive\.Content/);
    assert.match(modal, /DialogPrimitive\.Title/);
  });
  it("declares aria-modal and names the dialog (aria-label or the <ModalTitle> -> aria-labelledby)", () => {
    assert.match(modal, /aria-modal="true"/);
    assert.match(modal, /aria-label=\{ariaLabel\}/);
  });
  it("Esc and backdrop dismissal are configurable; a press that starts inside the panel never counts as a backdrop click", () => {
    assert.match(modal, /closeOnEscape/);
    assert.match(modal, /closeOnBackdrop/);
    assert.match(modal, /pressStartedOnBackdrop/);
  });
  it("registers Android Back through useBackDismissible", () => {
    assert.match(modal, /useBackDismissible\(open, onClose\)/);
  });
  it("close button: Vietnamese name and a 40px hit area", () => {
    assert.match(modal, /"aria-label": ariaLabel = "Đóng"/);
    assert.match(modal, /min-h-10 min-w-10/);
  });
  it("initial focus can be sent to a field (initialFocusRef) without the on-screen keyboard popping by default", () => {
    assert.match(modal, /onOpenAutoFocus/);
    assert.match(modal, /initialFocusRef/);
  });
});

describe("N14T-07: no English screen-reader text in the shared Radix wrappers", () => {
  for (const f of ["components/ui/dialog.tsx", "components/ui/sheet.tsx"]) {
    it(`${f}: sr-only "Đóng", aria-modal, 40px close`, () => {
      const src = read(f);
      assert.doesNotMatch(src, />Close</);
      assert.match(src, /<span className="sr-only">Đóng<\/span>/);
      assert.match(src, /aria-modal="true"/);
      assert.match(src, /size-10/);
    });
  }
});

describe("N14T-01/02/04: migrated team overlays no longer hand-roll `fixed inset-0`", () => {
  const MIGRATED = [
    "components/layout/AppShell.tsx",
    "components/layout/Topbar.tsx",
    "components/gym/GymDetailModal.tsx",
    "components/gym/GymPhotoGallery.tsx",
    "components/gym/CheckinScanModal.tsx",
    "components/gym/GymCheckinPanel.tsx",
    "components/gym/CollaborationPanel.tsx",
    "components/gym/ReportIssueDialog.tsx",
    "components/payment/PaymentMethodDialog.tsx",
    "components/pt-terms/PtTerms.tsx",
    "pages/gym-owner/MyGymsPage.tsx",
    "pages/gym-owner/GymPlansPage.tsx",
    "pages/gym-owner/ManageManagersPage.tsx",
    "pages/pt/AssignPlanModal.tsx",
    "pages/pt/PTContractsPage.tsx",
    "pages/pt/PTSchedulePage.tsx",
    "pages/pt/ClientFitnessSummaryCard.tsx",
    "pages/client/PTDiscoveryPage.tsx",
    "pages/client/BookingPage.tsx",
    "pages/client/ContractPage.tsx",
    "pages/partner-application/uploaders.tsx",
  ];
  for (const f of MIGRATED) {
    it(`${f} uses <Modal>/<Drawer>/Radix menus, not a bare fixed overlay`, () => {
      const src = read(f);
      assert.doesNotMatch(src, /fixed inset-0/, "hand-rolled overlay left behind");
      if (!/Topbar/.test(f)) assert.match(src, /ui\/Modal"/);
    });
  }
  it("the dead quick-create branch dialog is gone from MyGymsPage (the wizard is the only way in)", () => {
    const src = read("pages/gym-owner/MyGymsPage.tsx");
    assert.doesNotMatch(src, /showCreateGym|quickCreateGymService/);
  });
  it("admin overlays that use useModalA11y now lock the page scroll as well (N14T-04)", () => {
    const hook = read("pages/admin/shared/useModalA11y.ts");
    assert.match(hook, /lockPageScroll\(\)/);
    assert.match(hook, /querySelectorAll<HTMLElement>\("main"\)/);
  });
});

describe("Topbar (N14T-01 / N14T-08)", () => {
  const topbar = read("components/layout/Topbar.tsx");
  it("the user menu is a Radix DropdownMenu, the bell and AI-task list are Radix Popovers", () => {
    assert.match(topbar, /<DropdownMenu open=\{userOpen\}/);
    assert.match(topbar, /<Popover open=\{notifOpen\}/);
    assert.match(topbar, /<Popover open=\{aiTasksOpen/);
  });
  it("the hamburger has a name, the realtime dot has Vietnamese text", () => {
    assert.match(topbar, /aria-label="Mở menu"/);
    assert.doesNotMatch(topbar, /Realtime (connected|offline)/);
  });
  it("the mobile sidebar is the shared Drawer", () => {
    const shell = read("components/layout/AppShell.tsx");
    assert.match(shell, /<Drawer/);
    assert.match(shell, /ariaLabel="Menu điều hướng"/);
  });
});
