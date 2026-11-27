/**
 * Complaints moved from the sidebar to a Topbar button + AI Coach floating panel identity/close fixes.
 *
 * Evidence labels: the model tests (complaintDestinationsFor / isComplaintPath) are TEST FIXTURE-level unit tests of
 * exported functions; the "source" tests read source text and are CODE AUDIT only - they prove what the source says,
 * not how the page behaves (that was checked separately in a real browser).
 * Run: npx tsx --test src/app/components/layout/__tests__/complaintEntryAndAiCoachPanel.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_COMPLAINT_DESTINATIONS,
  complaintDestinationsFor,
  isComplaintPath,
  isOnDestination,
} from "../complaintEntry";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..", "..", "..");
const src = (rel: string) => readFileSync(resolve(appDir, rel), "utf8");
/** source without comments, so explanations may name what the code no longer does */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel: string) => strip(src(rel));

describe("sidebar no longer lists complaints (CODE AUDIT)", () => {
  const sidebar = code("components/layout/Sidebar.tsx");
  it("client / PT-member nav (clientNavFull) and PT workspace nav have no /disputes or /complaint-cases row", () => {
    const clientBlock = sidebar.slice(sidebar.indexOf("export const clientNavFull"), sidebar.indexOf("const gymOwnerNavFull"));
    const ptBlock = sidebar.slice(sidebar.indexOf("export const ptWorkspaceNav"), sidebar.indexOf("const adminNav"));
    for (const block of [clientBlock, ptBlock]) {
      assert.ok(block.length > 100);
      assert.ok(!block.includes('"/disputes"'));
      assert.ok(!block.includes('"/complaint-cases"'));
      assert.ok(!block.includes("Khiếu nại"));
    }
  });
  it("the gym-owner and admin complaint entries are untouched", () => {
    assert.ok(sidebar.includes('to: "/gym-owner/complaint-cases"'));
    assert.ok(sidebar.includes('to: "/admin/disputes"'));
    assert.ok(sidebar.includes('to: "/admin/complaints"'));
  });
  it("the desktop rail no longer reserves slots for the removed rows", () => {
    assert.ok(!code("components/layout/NightGlassRail.tsx").includes("/complaint-cases"));
  });
});

describe("header button destinations by role / mode (TEST FIXTURE)", () => {
  const to = (role: string, view: "client" | "pt") => complaintDestinationsFor(role, view).map((d) => d.to);
  it("client: both destinations", () => assert.deepEqual(to("client", "client"), ["/disputes", "/complaint-cases"]));
  it("PT in member mode: both destinations", () => assert.deepEqual(to("pt", "client"), ["/disputes", "/complaint-cases"]));
  it("PT in coach mode: only Khiếu nại của tôi (direct link, no menu)", () => assert.deepEqual(to("pt", "pt"), ["/disputes"]));
  it("gym owner / admin: no button", () => {
    assert.deepEqual(to("gym_owner", "client"), []);
    assert.deepEqual(to("admin", "client"), []);
  });
  it("labels are the Vietnamese names the sidebar used", () => {
    assert.deepEqual(ALL_COMPLAINT_DESTINATIONS.map((d) => d.label), ["Khiếu nại của tôi", "Khiếu nại phòng gym"]);
  });
});

describe("active state (TEST FIXTURE)", () => {
  const both = complaintDestinationsFor("client", "client");
  it("active on each route and its children", () => {
    for (const p of ["/disputes", "/disputes/abc", "/complaint-cases", "/complaint-cases/xyz"]) assert.equal(isComplaintPath(p, both), true, p);
  });
  it("not active elsewhere, and respects the segment boundary", () => {
    for (const p of ["/client/dashboard", "/disputes-archive", "/complaint-cases2", "/gym-owner/complaint-cases"]) assert.equal(isComplaintPath(p, both), false, p);
    assert.equal(isOnDestination("/disputes-archive", "/disputes"), false);
  });
  it("PT coach mode is active only on /disputes (its single destination)", () => {
    const pt = complaintDestinationsFor("pt", "pt");
    assert.equal(isComplaintPath("/disputes/1", pt), true);
    assert.equal(isComplaintPath("/complaint-cases", pt), false);
  });
});

describe("topbar wiring (CODE AUDIT)", () => {
  const topbar = code("components/layout/Topbar.tsx");
  it("button sits right after the role chip and before the AI-tasks / bell controls", () => {
    const chip = topbar.indexOf("workspaceBadge.label");
    const button = topbar.indexOf("<ComplaintEntryButton />");
    const aiTasks = topbar.indexOf("pendingCount > 0 &&");
    const bell = topbar.indexOf('data-testid="notification-bell"');
    assert.ok(chip > 0 && button > chip && button < aiTasks && aiTasks < bell);
  });
  const btn = code("components/layout/ComplaintEntryButton.tsx");
  it("accessible name, phosphor warning icon, shared menu primitive, theme tokens only", () => {
    assert.ok(btn.includes('"Khiếu nại"'));
    assert.ok(btn.includes("WarningCircleIcon"));
    assert.ok(btn.includes('from "../ui/dropdown-menu"'));
    assert.ok(btn.includes("aria-current"));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(btn), "no hardcoded hex colours");
    assert.ok(!/\b(?:rgb|hsl)a?\(/.test(btn));
  });
  it("Ctrl+K palette still offers both destinations", () => {
    const palette = code("components/layout/WorkspaceSearchPalette.tsx");
    assert.ok(palette.includes("ALL_COMPLAINT_DESTINATIONS"));
    assert.ok(palette.includes('"/disputes"') && palette.includes('"/complaint-cases"'), "keywords stay");
  });
  it("routes stay registered for client + PT", () => {
    const routes = code("routes.tsx");
    assert.ok(routes.includes('path: "disputes"') && routes.includes('path: "complaint-cases"'));
  });
});

describe("AI Coach panel closes on identity change (CODE AUDIT)", () => {
  const ctx = code("context/AppContext.tsx");
  it("AppProvider resets isAiCoachOpen whenever the authenticated user id changes", () => {
    assert.ok(/const aiCoachOwnerId = user\?\.id \?\? null;/.test(ctx));
    assert.ok(/if \(panelOwnerId !== aiCoachOwnerId\) \{\s*setPanelOwnerId\(aiCoachOwnerId\);\s*setIsAiCoachOpen\(false\);\s*\}/.test(ctx));
  });
  it("the hook runs before the isInitializing early return (rules of hooks)", () => {
    assert.ok(ctx.indexOf("panelOwnerId") < ctx.indexOf("if (isInitializing)"));
  });
  it("panel keys AICoachPage by user id", () => {
    assert.ok(/<AICoachPage key=\{user\?\.id \?\? "guest"\}/.test(code("components/layout/AICoachFloatingPanel.tsx")));
  });
  it("every AICoachPage query stays identity-scoped", () => {
    const page = code("pages/client/AICoachPage.tsx");
    const keys = [...page.matchAll(/queryKey: \[([^\]]*)\]/g)].map((m) => m[1]);
    assert.ok(keys.length >= 5);
    for (const k of keys) assert.ok(k.includes("userScopeId"), `unscoped key: ${k}`);
  });
});

describe("AI Coach compact panel always has a close control (CODE AUDIT)", () => {
  const page = code("pages/client/AICoachPage.tsx");
  const listStart = page.indexOf("<div\n        className={`${mobileView === \"chat\" ? \"hidden\" : \"flex\"}");
  const chatStart = page.indexOf("mobileView === \"list\" ? \"hidden\" : \"flex\"");
  it("the session-list view (shown when there are no conversations) renders the close button", () => {
    const listView = page.slice(listStart, chatStart);
    assert.ok(listStart > 0 && chatStart > listStart);
    assert.ok(listView.includes("{compact && onClose && panelCloseButton}"));
    // it sits next to "Cuộc trò chuyện mới", outside the sessions.length conditional
    assert.ok(listView.indexOf("panelCloseButton") < listView.indexOf("sessions.length > 0"));
  });
  it("the loading state and the Suspense fallback render it too", () => {
    const loading = page.slice(page.indexOf("if (isLoading)"), page.indexOf("const renderInline"));
    assert.ok(loading.includes("panelCloseButton"));
    assert.ok(code("components/layout/AICoachFloatingPanel.tsx").includes("onClick={closeAiCoach}"));
  });
  it("the chat header keeps its own close", () => {
    assert.ok(page.includes('aria-label="Đóng"'));
  });
  it("close is only offered in the floating panel (compact), never on the full page", () => {
    assert.ok(page.includes("compact && onClose"));
  });
});
