/**
 * FE2-FIX group D (NG-2, NG-3, OB-2, OB-3, NAV-3): source guards.
 * Evidence label: CODE AUDIT (the behaviour itself is proven in the browser run, see FE2_FIX_REPORT.md).
 * Run: npx tsx --test src/app/utils/__tests__/fe2FixGroupD.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const readStyle = (n: string) => readFileSync(new URL(`../../../styles/${n}`, import.meta.url), "utf8");

describe("NG-2 landing navbar uses the official logo", () => {
  const s = read("pages/public/LandingPage.tsx");
  it("no pwa-icon, theme-aware AppLogo, whole asset (gymini-brand-logo = contain)", () => {
    assert.doesNotMatch(s, /pwa-icon/);
    assert.match(s, /<AppLogo[^>]*gymini-brand-logo/);
  });
  it("AppLogo serves /brand/gymini-logo-{dark,light}", () => {
    const a = read("components/brand/AppLogo.tsx");
    assert.match(a, /\/brand\/gymini-logo-dark-384\.webp/);
    assert.match(a, /\/brand\/gymini-logo-light-384\.webp/);
  });
  it("the pill stays a pill", () => {
    assert.match(s, /rounded-full[^"]*\$\{scrolled \? "ng-glass"/);
  });
});

describe("NG-3 drawer: Obsidian active label, scoped to Client/PT; distinct complaint icons", () => {
  const s = read("components/layout/Sidebar.tsx");
  it("the Obsidian selection language only applies when role is client or pt", () => {
    assert.match(s, /const obsidian = role === "client" \|\| role === "pt";/);
    assert.match(s, /obsidian\s*\?\s*isActive[\s\S]{0,200}var\(--ob-text\)/);
    // the legacy green label is still the fallback for Gym Owner / Admin
    assert.match(s, /: isActive\s*\? "text-green-400"/);
  });
  it('"Khiếu nại của tôi" (gavel) and "Khiếu nại phòng gym" (flag) no longer share an icon', () => {
    assert.match(s, /label: "Khiếu nại của tôi", icon: GyminiDisputeIcon/);
    assert.match(s, /label: "Khiếu nại phòng gym", icon: GyminiComplaintIcon, to: "\/complaint-cases"/);
  });
  it("Gym Owner and Admin keep their own entries unchanged", () => {
    assert.match(s, /label: "Khiếu nại phòng gym", icon: GyminiDisputeIcon, to: "\/gym-owner\/complaint-cases"/);
    assert.match(s, /label: "Khiếu nại", icon: GyminiDisputeIcon, to: "\/admin\/complaints"/);
  });
});

describe("OB-2 body figure data loads lazily with a reserved box", () => {
  const a = read("components/dashboard/BodyAnalysis.tsx");
  const f = read("components/dashboard/BodyFigure.tsx");
  it("BodyAnalysis no longer imports body-muscles; the figure is a lazy chunk", () => {
    assert.doesNotMatch(a, /from "body-muscles"/);
    assert.match(a, /lazy\(\(\) => import\("\.\/BodyFigure"\)\)/);
    assert.match(f, /from "body-muscles"/);
  });
  it("a fallback with the figure's own aspect ratio reserves the space (no layout shift)", () => {
    assert.match(a, /<Suspense fallback=\{<BodyFigureFallback \/>\}>/);
    assert.match(a, /aspectRatio: "55 \/ 95"/);
  });
});

describe("OB-3 ?classic is gone", () => {
  it("ObsidianDashboard has no classic branch or lazy ClientDashboard import", () => {
    const s = read("pages/client/ObsidianDashboard.tsx");
    assert.doesNotMatch(s, /classic/i);
    assert.doesNotMatch(s, /lazy\(/);
  });
});

describe("NAV-3 Booking page-level tab bar is smaller and fainter (web only)", () => {
  it("TabbedPage adds the quiet classes only in the web branch and keeps the roles/ids", () => {
    const s = read("components/TabbedPage.tsx");
    assert.match(s, /WEB_UI \? `gw-tabs flex-none mx-4 md:mx-6 mt-4\$\{quiet \? " gw-tabs--quiet" : ""\}`/);
    assert.match(s, /role="tablist"/);
    assert.match(s, /data-testid=\{`page-tab-\$\{t\.value\}`\}/);
  });
  it("only ServicesPage (Tìm PT / Đặt lịch / Hợp đồng / Phòng gym / Hội viên gym) opts in", () => {
    assert.match(read("pages/client/ServicesPage.tsx"), /\bquiet\b/);
    for (const p of ["CoachingPage", "GymPage", "PlansPage", "TrainingPage"]) assert.doesNotMatch(read(`pages/client/${p}.tsx`), /\bquiet\b/, p);
  });
  it("quiet styling uses the Obsidian tokens at >= AA text colours and a thin indicator", () => {
    const c = readStyle("gymini-web-ui.css");
    assert.match(c, /\.gw-tab--quiet \{ font-size: 13px;[^}]*var\(--ob-text-3\)/);
    assert.match(c, /\.gw-tab--quiet\[aria-selected="true"\] \{ color: var\(--ob-text-2\);/);
    assert.match(c, /\.gw-tab--quiet \.gw-tab-bar \{ height: 1px;/);
  });
});
