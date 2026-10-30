// MOCK BROWSER TEST — B10 keyboard interaction checks (tablist arrows, drawer, dialogs, bell, skip link) + reduced-motion dialog/drawer animations.
import fs from "fs";
import { chromium, newPage, BASE, OUT } from "./mock-all.mjs";
const results = [];
const check = (name, cond, extra = "") => { results.push({ name, pass: !!cond, extra: String(extra) }); console.log(cond ? "PASS" : "FAIL", name, extra); };
const b = await chromium.launch();
const fi = (p) => p.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, txt: (a?.getAttribute("aria-label") || a?.textContent || "").trim().slice(0, 30), inDlg: !!a?.closest('[role="dialog"],[role="alertdialog"]'), tab: a?.getAttribute("role") === "tab", sel: a?.getAttribute("aria-selected") }; });
const rmAnims = (p) => p.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().duration > 0).map((a) => `${a.animationName || a.transitionProperty}:${a.effect.getComputedTiming().duration}`));

// 1. skip link + bell + money dialog (1440)
{
  const t = await newPage(b, { width: 1440, height: 900 });
  await t.page.goto(BASE + "/admin/finance/withdrawals"); await t.page.getByTestId("admin-withdrawals-page").waitFor({ timeout: 45000 }); await t.page.waitForTimeout(800);
  await t.page.keyboard.press("Tab");
  const f1 = await t.page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { txt: a.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; });
  check("skip link is first Tab stop and becomes visible", /Bỏ qua/.test(f1.txt) && f1.w > 50 && f1.h > 20, JSON.stringify(f1));
  await t.page.keyboard.press("Enter");
  check("skip link Enter focuses <main>", await t.page.evaluate(() => document.activeElement?.id === "admin-main"));
  const bell = t.page.getByTestId("notification-bell"); await bell.focus(); await t.page.keyboard.press("Enter");
  check("bell Enter opens the notification region", await t.page.getByRole("region", { name: "Thông báo" }).isVisible());
  await t.page.keyboard.press("Escape");
  check("bell Esc closes and returns focus to bell", !(await t.page.getByRole("region", { name: "Thông báo" }).count()) && (await t.page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "notification-bell");
  const ap = t.page.getByTestId("admin-withdrawal-approve-button").first(); await ap.focus(); await t.page.keyboard.press("Enter");
  const dlg = t.page.locator('[role="dialog"],[role="alertdialog"]').first(); await dlg.waitFor({ timeout: 8000 });
  check("money dialog has accessible name", !!(await dlg.getAttribute("aria-labelledby")));
  for (let i = 0; i < 10; i++) await t.page.keyboard.press("Tab");
  check("money dialog traps focus after 10 Tabs", (await fi(t.page)).inDlg, JSON.stringify(await fi(t.page)));
  await t.page.keyboard.press("Escape"); await t.page.waitForTimeout(500);
  check("money dialog Esc closes", (await t.page.locator('[role="dialog"],[role="alertdialog"]').count()) === 0);
  check("money dialog returns focus to its opener", await ap.evaluate((e) => e === document.activeElement), JSON.stringify(await fi(t.page)));
  await t.ctx.close();
}
// 2. tablist arrow keys
for (const [path, label, sel] of [["/admin/listings", "listings", '[role="tablist"][aria-label="Các mục"] [role="tab"]'], ["/admin/partners", "partners view tabs", '[role="tablist"][aria-label="Chế độ xem"] [role="tab"]'], ["/admin/gyms", "gyms moderation", '[data-testid="admin-gym-moderation-tabs"] [role="tab"]']]) {
  const t = await newPage(b, { width: 1440, height: 900 });
  await t.page.goto(BASE + path); await t.page.locator(sel).first().waitFor({ timeout: 45000 }); await t.page.waitForTimeout(800);
  const tabs = t.page.locator(sel); const n = await tabs.count();
  const idx = await tabs.evaluateAll((els) => els.findIndex((e) => e.getAttribute("aria-selected") === "true"));
  const tabIdx = await tabs.evaluateAll((els) => els.map((e) => e.tabIndex));
  check(`tablist ${label}: roving tabindex (selected=0, others=-1)`, tabIdx.filter((x) => x === 0).length === 1 && tabIdx[idx] === 0 && tabIdx.filter((x) => x === -1).length === n - 1, JSON.stringify(tabIdx));
  await tabs.nth(idx).focus();
  await t.page.keyboard.press("ArrowRight"); await t.page.waitForTimeout(400);
  const f = await fi(t.page);
  check(`tablist ${label}: ArrowRight moves focus + selects next tab`, f.tab && f.sel === "true" && (await tabs.nth((idx + 1) % n).evaluate((e) => e === document.activeElement)), JSON.stringify(f));
  if (label === "listings") {
    await t.page.keyboard.press("ArrowLeft"); await t.page.waitForTimeout(300);
    check(`tablist ${label}: ArrowLeft returns to first`, await tabs.nth(0).evaluate((e) => e === document.activeElement && e.getAttribute("aria-selected") === "true"));
    await t.page.keyboard.press("Tab");
    check(`tablist ${label}: Tab leaves the strip`, !(await fi(t.page)).tab, JSON.stringify(await fi(t.page)));
    await t.ctx.close(); continue;
  }
  await t.page.keyboard.press("End"); await t.page.waitForTimeout(300);
  check(`tablist ${label}: End -> last tab selected`, await tabs.nth(n - 1).evaluate((e) => e === document.activeElement && e.getAttribute("aria-selected") === "true"));
  await t.page.keyboard.press("ArrowRight"); await t.page.waitForTimeout(300);
  check(`tablist ${label}: ArrowRight wraps to first`, await tabs.nth(0).evaluate((e) => e === document.activeElement && e.getAttribute("aria-selected") === "true"));
  await t.page.keyboard.press("ArrowLeft"); await t.page.waitForTimeout(300);
  check(`tablist ${label}: ArrowLeft wraps to last`, await tabs.nth(n - 1).evaluate((e) => e === document.activeElement));
  await t.page.keyboard.press("Home"); await t.page.waitForTimeout(300);
  await t.page.keyboard.press("Tab");
  check(`tablist ${label}: Tab leaves the strip`, !(await fi(t.page)).tab, JSON.stringify(await fi(t.page)));
  await t.ctx.close();
}
// 3. mobile drawer
{
  const t = await newPage(b, { width: 390, height: 844 });
  await t.page.goto(BASE + "/admin/finance"); await t.page.getByTestId("admin-menu-button").waitFor({ timeout: 45000 }); await t.page.waitForTimeout(800);
  const mb = t.page.getByTestId("admin-menu-button"); await mb.focus(); await t.page.keyboard.press("Enter");
  await t.page.getByTestId("admin-drawer").waitFor();
  for (let i = 0; i < 40; i++) await t.page.keyboard.press("Tab");
  check("drawer traps focus after 40 Tabs", (await fi(t.page)).inDlg, JSON.stringify(await fi(t.page)));
  await t.page.keyboard.press("Escape"); await t.page.waitForTimeout(500);
  check("drawer Esc closes", (await t.page.getByTestId("admin-drawer").count()) === 0);
  check("drawer returns focus to menu button", await mb.evaluate((e) => e === document.activeElement));
  await t.ctx.close();
}
// 4. reduced motion: open drawer / dialog: no running CSS animation or transition
{
  const t = await newPage(b, { width: 390, height: 844, reduced: true });
  await t.page.goto(BASE + "/admin/finance/withdrawals"); await t.page.getByTestId("admin-menu-button").waitFor({ timeout: 45000 }); await t.page.waitForTimeout(800);
  await t.page.getByTestId("admin-menu-button").click(); await t.page.waitForTimeout(30);
  const a1 = await rmAnims(t.page); check("reduced motion: drawer opening runs no CSS animation/transition", a1.length === 0, a1.join(","));
  await t.page.keyboard.press("Escape"); await t.page.waitForTimeout(300);
  await t.page.getByTestId("admin-withdrawal-approve-button").first().click(); await t.page.waitForTimeout(30);
  const a2 = await rmAnims(t.page); check("reduced motion: money dialog opening runs no CSS animation/transition", a2.length === 0, a2.join(","));
  await t.ctx.close();
}
// 4b. normal motion sanity: dialog still animates (the rule is reduced-motion only)
{
  const t = await newPage(b, { width: 1440, height: 900 });
  await t.page.goto(BASE + "/admin/finance/withdrawals"); await t.page.getByTestId("admin-withdrawal-approve-button").first().waitFor({ timeout: 45000 }); await t.page.waitForTimeout(800);
  await t.page.getByTestId("admin-withdrawal-approve-button").first().click(); await t.page.waitForTimeout(30);
  const a = await rmAnims(t.page); check("normal motion: dialog open animation still runs (<=220ms)", a.length > 0 && a.every((x) => parseFloat(x.split(":")[1]) <= 220), a.join(","));
  await t.ctx.close();
}
// 5. clickable EntityCard (gym-management attention list) is keyboard-operable
{
  const t = await newPage(b, { width: 1440, height: 900 });
  await t.page.goto(BASE + "/admin/gym-management"); await t.page.waitForTimeout(3000);
  const link = t.page.getByRole("link", { name: /Hồ sơ đối tác chờ duyệt/ }).first();
  check("gym-management attention card is a focusable link", (await link.count()) > 0 && (await link.getAttribute("tabindex")) === "0");
  await link.focus(); await t.page.keyboard.press("Enter"); await t.page.waitForTimeout(800);
  check("gym-management attention card Enter navigates", /\/admin\/partners/.test(t.page.url()), t.page.url());
  await t.ctx.close();
}
// 6. hand-rolled exercise-review modal: dialog role, Esc, focus return
{
  const t = await newPage(b, { width: 1440, height: 900 });
  await t.page.goto(BASE + "/admin/exercise-review"); await t.page.waitForTimeout(3000);
  const opener = t.page.locator("#admin-main [data-testid]").filter({ hasText: /\S/ }).first();
  const ids = await t.page.evaluate(() => [...document.querySelectorAll("#admin-main [data-testid]")].map((e) => e.getAttribute("data-testid")).slice(0, 12));
  console.log("exercise-review testids:", ids.join(","));
  const row = t.page.locator("#admin-main button").filter({ hasText: /\S{3,}/ }).nth(3);
  const rowCount = await t.page.getByTestId("exercise-review-open-detail").count();
  if (rowCount > 0) {
    const o = t.page.getByTestId("exercise-review-open-detail").first();
    await o.focus(); await t.page.keyboard.press("Enter");
    const m = t.page.getByTestId("exercise-review-detail-modal"); await m.waitFor({ timeout: 8000 });
    check("exercise-review modal has role=dialog, aria-modal, name", (await m.getAttribute("role")) === "dialog" && (await m.getAttribute("aria-modal")) === "true" && !!(await m.getAttribute("aria-labelledby")));
    check("exercise-review modal moves focus inside", await m.evaluate((e) => e.contains(document.activeElement)));
    for (let i = 0; i < 12; i++) await t.page.keyboard.press("Tab");
    check("exercise-review modal traps focus after 12 Tabs", await m.evaluate((e) => e.contains(document.activeElement)));
    await t.page.keyboard.press("Escape"); await t.page.waitForTimeout(400);
    check("exercise-review modal Esc closes", (await t.page.getByTestId("exercise-review-detail-modal").count()) === 0);
    check("exercise-review modal returns focus to opener", await o.evaluate((e) => e === document.activeElement));
  } else check("exercise-review: candidate row available in mock", false, "no data-testid*=candidate");
  await t.ctx.close();
}
fs.writeFileSync(`${OUT}/b10-keyboard-results.json`, JSON.stringify(results, null, 1));
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
await b.close();
