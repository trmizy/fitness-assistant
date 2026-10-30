// ConfirmDialog (non-danger) contrast: admin call site AdminApplicationsPanel "Phê duyệt hồ sơ?"
import fs from "fs";
import { chromium, newPage, BASE, OUT, axeRun } from "./mock-all.mjs";
const label = process.env.LABEL; // before | after
const b = await chromium.launch();
const out = [];
for (const theme of ["light", "dark"]) {
  const t = await newPage(b, { width: 1440, height: 900, theme });
  await t.page.goto(`${BASE}/admin/partners?view=applications&id=d3d3d3d3-0000-4000-8000-000000000003`);
  await t.page.getByRole("button", { name: /Phê duyệt hồ sơ/ }).first().waitFor({ timeout: 45000 });
  await t.page.getByRole("button", { name: /Phê duyệt hồ sơ/ }).first().click();
  const dlg = t.page.locator('[role="alertdialog"]'); await dlg.waitFor();
  await t.page.waitForTimeout(600);
  const btn = dlg.getByRole("button", { name: "Phê duyệt", exact: true });
  const cs = await btn.evaluate((e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, color: s.color }; });
  const ax = await axeRun(t.page);
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const r = { theme, ...cs, contrast: +ratio(cs.bg, cs.color).toFixed(2), axe: ax.map((a) => a.id + ":" + a.n + " " + a.nodes.join(" / ").slice(0, 300)) };
  out.push(r); console.log(label, JSON.stringify(r));
  await dlg.screenshot({ path: `${OUT}/confirm-dialog-${label}-${theme}.png` });
  await t.ctx.close();
}
fs.writeFileSync(`${OUT}/confirm-dialog-${label}.json`, JSON.stringify(out, null, 1));
await b.close();
