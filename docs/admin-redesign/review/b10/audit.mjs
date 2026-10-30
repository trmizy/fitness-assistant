// MOCK BROWSER TEST — B10 audit: axe + landmarks + headings + target size + keyboard walk, per route x variant.
import fs from "fs";
import { chromium, newPage, BASE, ROUTES, OUT, axeRun } from "./mock-all.mjs";
const VARIANTS = [[1440, 900, "light"], [1440, 900, "dark"], [390, 844, "light"]];
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const b = await chromium.launch();
const out = process.env.OUTFILE || `${OUT}/audit-raw.json`;
const res = [];
for (const [k, path] of ROUTES) {
  if (only && !only.includes(k)) continue;
  for (const [w, h, theme] of VARIANTS) {
    const tag = `${k}@${w}${theme === "dark" ? "-dark" : ""}`;
    const t = await newPage(b, { width: w, height: h, theme });
    await t.page.goto(BASE + path);
    await t.page.locator("#admin-main h1, #admin-main [data-testid]").first().waitFor({ timeout: 45000 }).catch(() => {});
    await t.page.waitForTimeout(2000);
    const r = { tag, errors: t.errors.slice(0, 2) };
    r.axe = await axeRun(t.page);
    Object.assign(r, await t.page.evaluate(({ w }) => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map((e) => +e.tagName[1]);
      let skips = 0; for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) skips++;
      const sel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch],[role=menuitem],[tabindex]:not([tabindex="-1"])';
      const small = []; const small44 = []; const smallOk = [];
      const all = [...document.querySelectorAll(sel)].filter(vis).filter((e) => !e.closest(".sr-only"));
      const rects = all.map((e) => e.getBoundingClientRect());
      const distToRect = (cx, cy, q) => { const dx = Math.max(q.left - cx, 0, cx - q.right); const dy = Math.max(q.top - cy, 0, cy - q.bottom); return Math.hypot(dx, dy); };
      for (let i = 0; i < all.length; i++) {
        const e = all[i]; const r = rects[i];
        const inline = e.tagName === "A" && getComputedStyle(e).display === "inline" && e.closest("p,li,span,td");
        const d = { t: e.tagName.toLowerCase(), id: e.getAttribute("data-testid") || "", txt: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
        if ((r.width < 24 || r.height < 24) && !inline) {
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const crowded = rects.some((q, j) => j !== i && !all[j].contains(e) && !e.contains(all[j]) && distToRect(cx, cy, q) < 12);
          (crowded ? small : smallOk).push(d);
        }
        else if (w <= 400 && (r.width < 44 || r.height < 44) && !inline) small44.push(d);
      }
      return {
        landmarks: { main: document.querySelectorAll("main,[role=main]").length, nav: document.querySelectorAll("nav,[role=navigation]").length, banner: document.querySelectorAll("header,[role=banner]").length, aside: document.querySelectorAll("aside").length },
        h1: document.querySelectorAll("h1").length, headings: heads.join(""), headingSkips: skips,
        live: { status: document.querySelectorAll('[role=status],[aria-live=polite]').length, alert: document.querySelectorAll('[role=alert],[aria-live=assertive]').length },
        small, smallOk: smallOk.length, small44: small44.length, small44s: small44.slice(0, 6), title: document.title,
        navs: [...document.querySelectorAll("nav,[role=navigation]")].map((n) => n.getAttribute("aria-label") || n.getAttribute("aria-labelledby") || "(unlabelled)"),
        posTabindex: document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').length,
        imgNoAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length,
        btnNoName: [...document.querySelectorAll("button,[role=button],a[href]")].filter((e) => vis(e) && !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.textContent.trim() || e.querySelector("img[alt]"))).length,
      };
    }, { w }));
    // keyboard walk
    await t.page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    const stops = []; let bad = [];
    for (let i = 0; i < 70; i++) {
      await t.page.keyboard.press("Tab");
      const f = await t.page.evaluate(() => {
        const e = document.activeElement; if (!e || e === document.body) return null;
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        const ind = (n) => { const c = getComputedStyle(n); return (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || (c.boxShadow && c.boxShadow !== "none"); };
        const wrap = e.closest("label");
        const outline = ind(e) || (!!wrap && ind(wrap));
        const ring = false;
        const fv = e.matches(":focus-visible");
        return { t: e.tagName.toLowerCase(), id: e.getAttribute("data-testid") || "", txt: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 22), outline, ring, fv, w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden", sr: !!e.closest(".sr-only") && cs.position === "absolute" && r.width <= 1 };
      });
      if (!f) { stops.push(null); break; }
      stops.push(f);
      if (!(f.outline || f.ring)) bad.push(`${f.t}[${f.id || f.txt}] noIndicator`);
      if (!f.visible || f.sr) bad.push(`${f.t}[${f.id || f.txt}] invisibleFocus`);
      if (stops.length > 2 && stops[0] && f.t === stops[0].t && f.txt === stops[0].txt && f.id === stops[0].id) break;
    }
    r.kb = { stops: stops.filter(Boolean).length, first: stops[0] && `${stops[0].t}:${stops[0].txt}`, bad: [...new Set(bad)].slice(0, 8) };
    res.push(r);
    console.log(tag, "axe", r.axe.length, "small<24(crowded)", r.small.length, "ok-by-spacing", r.smallOk, "small<44@390", r.small44, "kbStops", r.kb.stops, "kbBad", r.kb.bad.length, "h1", r.h1, "skips", r.headingSkips, r.errors.length ? "ERR " + r.errors[0] : "");
    await t.ctx.close();
  }
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
await b.close();
