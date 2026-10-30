// MOCK BROWSER TEST — B10 audit 2: reduced-motion running animations, loading-state animations, CLS on data load.
import fs from "fs";
import { chromium, newPage, BASE, ROUTES, OUT } from "./mock-all.mjs";
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const b = await chromium.launch();
const res = [];
const probe = () => document.getAnimations().filter((a) => a.playState === "running" && (a.effect?.getComputedTiming().duration > 0)).map((a) => { const t = a.effect.target; const k = a.animationName || a.transitionProperty || "?"; return `${a.constructor.name}:${k}:${a.effect.getComputedTiming().duration}ms@${t?.tagName?.toLowerCase()}.${(t?.getAttribute?.("class") || "").slice(0, 50)}`; });
for (const [k, path] of ROUTES) {
  if (only && !only.includes(k)) continue;
  const r = { k };
  // (a) reduced motion, loading state (requests held)
  for (const [mode, opts] of [["rm-loading", { hang: true }], ["rm-loaded", {}], ["norm-loading", { hang: true, noRm: true }]]) {
    const t = await newPage(b, { width: 1440, height: 900, reduced: !opts.noRm, hang: opts.hang });
    await t.page.goto(BASE + path);
    await t.page.locator("#admin-main").waitFor({ timeout: 45000 }).catch(() => {});
    await t.page.waitForTimeout(opts.hang ? 1800 : 2500);
    r[mode] = await t.page.evaluate(probe);
    await t.ctx.close();
  }
  // (b) CLS with delayed responses (500 ms) — total + sources after first paint
  {
    const t = await newPage(b, { width: 1440, height: 900, delay: 500 });
    await t.page.addInitScript(() => { window.__cls = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls.push({ v: e.value, t: Math.round(e.startTime), src: (e.sources || []).slice(0, 3).map((s) => (s.node?.getAttribute?.("data-testid") || s.node?.nodeName || "?") + "@" + (s.node?.parentElement?.getAttribute?.("data-testid") || s.node?.parentElement?.nodeName || "")) }); }).observe({ type: "layout-shift", buffered: true }); });
    await t.page.goto(BASE + path);
    await t.page.locator("#admin-main").waitFor({ timeout: 45000 }).catch(() => {});
    await t.page.waitForTimeout(3500);
    const cls = await t.page.evaluate(() => window.__cls);
    r.cls = { total: +cls.reduce((a, c) => a + c.v, 0).toFixed(4), n: cls.length, top: cls.sort((a, b) => b.v - a.v).slice(0, 3) };
    await t.ctx.close();
  }
  res.push(r);
  console.log(k, "RM-loading:", r["rm-loading"].length, "RM-loaded:", r["rm-loaded"].length, "normal-loading:", r["norm-loading"].length, "CLS", r.cls.total, "(" + r.cls.n + ")");
  if (r["rm-loading"].length || r["rm-loaded"].length) console.log("   RM!", [...new Set([...r["rm-loading"], ...r["rm-loaded"]])].slice(0, 6).join(" | "));
}
fs.writeFileSync(process.env.OUTFILE || `${OUT}/audit2-raw.json`, JSON.stringify(res, null, 1));
await b.close();
