// MOCK BROWSER TEST — B6a: Tài chính › Hoàn tiền (service + membership refunds) + MoneyActionDialog contrast.
// All /api/** is answered by page.route; no real backend / API / DB is touched.
import fs from "fs";
import { chromium, BASE, OUT, makeState, newPage, rready, rrows, ready, rows as wrows, oid, check, save, axeRun, overflow } from "./harness.mjs";

const URL = (q = "") => `${BASE}/admin/finance/refunds${q}`;
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
const chip = (page, t) => page.getByTestId(`admin-refunds-chip-${t}`);
const rowOf = (page, n) => page.locator(`[data-order-id="${oid(n)}"]`);
const txt = (loc) => loc.innerText();
const activeChip = async (page) => ((await chip(page, "service").getAttribute("aria-pressed")) === "true" ? "service" : (await chip(page, "membership").getAttribute("aria-pressed")) === "true" ? "membership" : "none");
const focusId = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") || document.activeElement?.tagName);
const GOOD_ID = "123e4567-e89b-12d3-a456-426614174000";

async function load(browser, { w, h, query = "", state = makeState(), scheme = "light", clock = false, clipboard = false, wait = true }) {
  const env = await newPage(browser, { width: w, height: h, state, colorScheme: scheme, clock, clipboard });
  await env.page.goto(URL(query));
  await rready(env.page);
  if (wait && !/type=membership/.test(query)) await rrows(env.page).first().waitFor({ timeout: 15000 });
  await env.page.waitForTimeout(250);
  return { ...env, state };
}
async function openRow(page, n) {
  await rowOf(page, n).getByTestId("refund-row-toggle").click();
  await rowOf(page, n).getByTestId("refund-amount-input").waitFor({ timeout: 10000 });
}
async function prepare(page, n, amount, note = "Chưa giao bản nháp trong hạn") {
  await openRow(page, n);
  await rowOf(page, n).getByLabel("Ghi chú quyết định").fill(note);
  await rowOf(page, n).getByTestId("refund-amount-input").fill(amount);
}
const trapStaysInside = async (page, n = 8) => {
  let inside = true;
  for (let i = 0; i < n; i++) { await page.keyboard.press("Tab"); inside = inside && (await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))); }
  for (let i = 0; i < n; i++) { await page.keyboard.press("Shift+Tab"); inside = inside && (await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))); }
  return inside;
};

const axeResults = [];
const axeCheck = async (name, page, include) => {
  const v = await axeRun(page, include);
  axeResults.push({ name, violations: v });
  check(`axe serious+critical = 0 — ${name}`, v.length === 0, v.join(" ;; "));
};

const browser = await chromium.launch();
try {
  for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    const T = `[${tag}]`;

    // ───────── 1. default view: service chip, queue rows (plan §2.4) ─────────
    {
      const { page, errors, ctx } = await load(browser, { w, h });
      check(`${T} default chip = Dịch vụ cá nhân hoá (no ?type=)`, (await activeChip(page)) === "service");
      check(`${T} 3 rows, oldest request first (3 ngày → 6 giờ → 40 phút)`, (await rrows(page).count()) === 3 && (await rrows(page).nth(0).getAttribute("data-order-id")) === oid(1) && (await rrows(page).nth(2).getAttribute("data-order-id")) === oid(3));
      check(`${T} service chip count = 3`, (await txt(page.getByTestId("admin-refunds-chip-count-service"))) === "3");
      const sum = await txt(page.getByTestId("admin-refunds-summary"));
      check(`${T} summary: 3 yêu cầu đang chờ · cũ nhất 3 ngày — and NO money total`, /3 yêu cầu đang chờ/.test(sum) && /cũ nhất 3 ngày/.test(sum) && !sum.includes("₫"), sum.replace(/\s+/g, " "));
      const wn = await txt(page.getByTestId("admin-refunds-wallet-note"));
      check(`${T} wallet note: ghi có vào ví khách hàng, không phải chuyển khoản`, wn.includes("ghi có vào ví khách hàng") && wn.includes("không phải chuyển khoản"));
      check(`${T} price cell right-aligned tabular VND (2.000.000 ₫)`, (await txt(rowOf(page, 1).getByTestId("admin-refund-price"))).includes("2.000.000") && (await rowOf(page, 1).getByTestId("admin-refund-price").evaluate((el) => getComputedStyle(el).fontVariantNumeric.includes("tabular") && getComputedStyle(el.parentElement).textAlign === "right")));
      check(`${T} age of 6h row = 6 giờ; 40 phút row`, (await txt(rowOf(page, 2))).includes("6 giờ") && (await txt(rowOf(page, 3))).includes("40 phút"));
      check(`${T} status pill "Chờ xử lý hoàn tiền" on every row`, (await page.getByTestId("admin-refund-status-pill").count()) === 3 && (await txt(page.getByTestId("admin-refund-status-pill").first())).includes("Chờ xử lý hoàn tiền"));
      check(`${T} 3 copy buttons per row (khách, PT, đơn) + short ids shown`, (await rowOf(page, 1).getByTestId("admin-refund-copy-id").count()) === 3 && (await txt(rowOf(page, 1))).includes("eeeeeeee"));
      check(`${T} buyer's reason shown as-is`, (await txt(rowOf(page, 1))).includes("Chưa nhận được bản nháp"));
      check(`${T} no status chips (API has no status filter) + data-limit note present`, (await page.locator('[data-testid^="admin-refunds-chip-"]').count()) === 3 && (await txt(page.getByTestId("admin-refunds-data-note"))).includes("chưa có API"));
      check(`${T} no page errors / no error panel`, errors.length === 0 && (await page.getByTestId("refund-requests-error").count()) === 0, errors.join("|"));
      await shot(page, `list-service-${tag}`, { fullPage: true });
      if (tag === "390") { const o = await overflow(page); check(`${T} no horizontal overflow (list)`, o.sw <= o.cw, `${o.sw}/${o.cw}`); }
      // chip → membership, URL, back/forward
      await chip(page, "membership").click();
      await page.waitForURL(/type=membership/);
      await page.getByTestId("admin-refunds-membership").waitFor();
      check(`${T} click membership chip → ?type=membership, form visible, queue hidden`, (await activeChip(page)) === "membership" && (await page.getByTestId("membership-refund-id-input").isVisible()) && (await page.getByTestId("refund-requests-list").count()) === 0);
      const mn = await txt(page.getByTestId("admin-refunds-membership-note"));
      check(`${T} membership gap stated honestly (no list / no read-by-id / amount not previewed or estimated)`, mn.includes("chưa có API") && mn.includes("không ước tính") && mn.includes("ngoại lệ"));
      check(`${T} wallet note still shown on the membership chip`, await page.getByTestId("admin-refunds-wallet-note").isVisible());
      await shot(page, `membership-${tag}`, { fullPage: true });
      if (tag === "390") { const o = await overflow(page); check(`${T} no horizontal overflow (membership)`, o.sw <= o.cw, `${o.sw}/${o.cw}`); }
      await page.goBack();
      await page.waitForFunction(() => !location.search.includes("membership"));
      await page.waitForTimeout(300);
      check(`${T} Back returns to the service chip with the 3 rows`, (await activeChip(page)) === "service" && (await rrows(page).count()) === 3);
      await page.goForward();
      await page.waitForFunction(() => location.search.includes("membership"));
      check(`${T} Forward returns to membership`, (await activeChip(page)) === "membership");
      await ctx.close();
    }

    // ───────── 2. deep links + legacy URLs ─────────
    {
      let r = await load(browser, { w, h, query: "?type=membership" });
      check(`${T} deep link ?type=membership opens the membership chip`, (await activeChip(r.page)) === "membership" && (await r.page.getByTestId("membership-refund-id-input").isVisible()));
      await shot(r.page, `deeplink-membership-${tag}`);
      await r.ctx.close();
      for (const bad of ["?type=service", "?type=garbage", "?type=", "?kind=membership"]) {
        r = await load(browser, { w, h, query: bad });
        check(`${T} deep link ${bad} → service chip, 3 rows`, (await activeChip(r.page)) === "service" && (await rrows(r.page).count()) === 3);
        await r.ctx.close();
      }
      for (const legacy of ["/admin/finance?tab=refunds", "/admin/pt-service-refunds"]) {
        const env = await newPage(browser, { width: w, height: h, state: makeState() });
        await env.page.goto(`${BASE}${legacy}`);
        await rready(env.page);
        check(`${T} legacy ${legacy} lands on /admin/finance/refunds`, /\/admin\/finance\/refunds/.test(env.page.url()), env.page.url());
        await env.ctx.close();
      }
    }

    // ───────── 3. expand: real numbers, E-10 cap, H-04 approve dialog, one POST ─────────
    {
      const state = makeState(); state.resolve = "slow";
      const { page, ctx } = await load(browser, { w, h, state });
      await openRow(page, 1);
      const rt = await txt(rowOf(page, 1));
      check(`${T} expanded: total paid 2.000.000 / already 500.000 / ceiling 1.500.000 + milestones`, ["2.000.000", "500.000", "1.500.000", "Khách đã gửi thông tin ban đầu", "Đã giao bản nháp"].every((s) => rt.includes(s)));
      check(`${T} expand button aria-expanded=true`, (await rowOf(page, 1).getByTestId("refund-row-toggle").getAttribute("aria-expanded")) === "true");
      const approve = rowOf(page, 1).getByTestId("approve-refund-button");
      check(`${T} approve disabled until note + valid amount`, await approve.isDisabled());
      await rowOf(page, 1).getByLabel("Ghi chú quyết định").fill("Chưa giao bản nháp trong hạn");
      await rowOf(page, 1).getByTestId("refund-amount-input").fill("1500001");
      check(`${T} E-10 amount > ceiling → "vượt mức" message + approve disabled`, (await txt(rowOf(page, 1).getByTestId("refund-amount-error"))).includes("vượt mức") && (await approve.isDisabled()));
      await rowOf(page, 1).getByTestId("refund-amount-input").fill("0");
      check(`${T} amount 0 blocked`, await approve.isDisabled());
      await rowOf(page, 1).getByTestId("refund-amount-input").fill("1500000");
      check(`${T} amount = ceiling enables approve`, !(await approve.isDisabled()));
      await rowOf(page, 1).getByTestId("refund-amount-input").fill("1000000");
      await shot(page, `expanded-${tag}`, { fullPage: true });
      await approve.click();
      const dlg = page.getByTestId("refund-approve-dialog");
      await dlg.waitFor();
      check(`${T} approve opens dialog; no POST yet`, state.rcounts.resolve === 0);
      const dt = await dlg.innerText();
      check(`${T} H-04 dialog: amount 1.000.000, facts 2.000.000/500.000/1.500.000, "ví khách hàng", "không hoàn về thẻ hay ngân hàng", partial text, "Không thể hoàn tác"`,
        (await txt(dlg.getByTestId("refund-approve-dialog-amount"))).includes("1.000.000") && ["2.000.000", "500.000", "1.500.000", "ví khách hàng", "không hoàn về thẻ hay ngân hàng", "Hoàn một phần", "Không thể hoàn tác", "Chưa giao bản nháp trong hạn"].every((s) => dt.includes(s)));
      await shot(page, `approve-dialog-${tag}`);
      if (tag === "390") { const o = await overflow(page); check(`${T} no overflow with approve dialog open`, o.sw <= o.cw, `${o.sw}/${o.cw}`); }
      const confirm = dlg.getByTestId("refund-approve-dialog-confirm");
      await confirm.dblclick();
      await confirm.click({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
      check(`${T} busy: confirm disabled + aria-busy; Esc inert`, (await confirm.isDisabled()) && (await confirm.getAttribute("aria-busy")) === "true");
      await page.keyboard.press("Escape");
      check(`${T} Esc ignored while busy`, await dlg.isVisible());
      await dlg.waitFor({ state: "hidden", timeout: 10000 });
      check(`${T} double click ⇒ exactly 1 POST`, state.rcounts.resolve === 1, `count=${state.rcounts.resolve}`);
      const body = JSON.parse(state.rbody);
      check(`${T} payload {decision:APPROVE, refundAmount:1000000, note}`, body.decision === "APPROVE" && body.refundAmount === 1000000 && body.note === "Chưa giao bản nháp trong hạn", state.rbody);
      await page.waitForTimeout(700);
      check(`${T} after server OK: row left the list (2 left), chip count 2`, (await rrows(page).count()) === 2 && (await txt(page.getByTestId("admin-refunds-chip-count-service"))) === "2");
      check(`${T} focus moved to a chip (not lost on <body>)`, (await focusId(page)) === "admin-refunds-chip-service", await focusId(page));
      await ctx.close();
    }

    // ───────── 4. per-row pending: other rows stay usable while one POST is in flight ─────────
    {
      const state = makeState(); state.resolve = "slow";
      const { page, ctx } = await load(browser, { w, h, state });
      await prepare(page, 1, "1500000");
      await prepare(page, 2, "900000", "Hết hạn");
      await rowOf(page, 1).getByTestId("approve-refund-button").click();
      await page.getByTestId("refund-approve-dialog").waitFor();
      await page.getByTestId("refund-approve-dialog-confirm").click();
      await page.waitForTimeout(300);
      check(`${T} row 1 in flight: row 2 approve still enabled`, !(await rowOf(page, 2).getByTestId("approve-refund-button").isDisabled()));
      await page.getByTestId("refund-approve-dialog").waitFor({ state: "hidden", timeout: 10000 });
      check(`${T} full-ceiling approve = 1 POST, row 1 gone`, state.rcounts.resolve === 1 && (await rowOf(page, 1).count()) === 0);
      await ctx.close();
    }

    // ───────── 5. 409 / 400 stale, 500, network loss (E-07) ─────────
    for (const mode of ["409", "400", "500", "abort"]) {
      const state = makeState(); state.resolve = mode;
      const { page, ctx } = await load(browser, { w, h, state });
      await prepare(page, 1, mode === "400" ? "1000000" : "1000000");
      await rowOf(page, 1).getByTestId("approve-refund-button").click();
      const dlg = page.getByTestId("refund-approve-dialog");
      await dlg.getByTestId("refund-approve-dialog-confirm").click();
      await dlg.getByTestId("refund-approve-dialog-error").waitFor();
      const e = await txt(dlg.getByTestId("refund-approve-dialog-error"));
      const listBefore = state.rcounts.list;
      await page.waitForTimeout(900);
      check(`${T} ${mode}: no auto-retry of the POST (count stays 1)`, state.rcounts.resolve === 1, `count=${state.rcounts.resolve}`);
      check(`${T} ${mode}: confirm is blocked inside the dialog`, await dlg.getByTestId("refund-approve-dialog-confirm").isDisabled());
      if (mode === "409") check(`${T} 409: specific message "không còn chờ hoàn tiền"`, e.includes("không còn chờ hoàn tiền"), e);
      if (mode === "400") check(`${T} 400 INVALID_AMOUNT: "không hợp lệ hoặc vượt mức" + stale refetch`, e.includes("không hợp lệ hoặc vượt mức"), e);
      if (mode === "500") check(`${T} 500: "Chưa xác nhận được kết quả" (unknown outcome), no [object Object]`, e.includes("Chưa xác nhận được kết quả") && !e.includes("object"), e);
      if (mode === "abort") check(`${T} network loss: "Chưa xác nhận được kết quả" + dialog stays open`, e.includes("Chưa xác nhận được kết quả") && (await dlg.isVisible()), e);
      if (mode === "409" || mode === "400") {
        check(`${T} ${mode}: list AND calculation refetched`, state.rcounts.list > 1 && state.rcounts.calc > 1, `list=${state.rcounts.list} calc=${state.rcounts.calc}`);
        check(`${T} ${mode}: a toast carries the message too (the row may vanish)`, (await page.locator("[data-sonner-toast]").count()) >= 1);
      }
      await shot(page, `approve-${mode}-${tag}`);
      if (mode === "abort" || mode === "500") {
        await dlg.getByTestId("refund-approve-dialog-reload").click();
        await dlg.waitFor({ state: "hidden" });
        check(`${T} ${mode}: "Tải lại trạng thái" re-GETs the list and does NOT re-POST`, state.rcounts.list > listBefore && state.rcounts.resolve === 1, `list ${listBefore}->${state.rcounts.list}, resolve=${state.rcounts.resolve}`);
      }
      await ctx.close();
    }

    {
      // the row is decided elsewhere: the 409 re-fetch removes the row (and the dialog living in it) → the toast must carry the message
      const state = makeState(); state.resolve = "409gone";
      const { page, ctx } = await load(browser, { w, h, state });
      await prepare(page, 1, "1000000");
      await rowOf(page, 1).getByTestId("approve-refund-button").click();
      await page.getByTestId("refund-approve-dialog-confirm").click();
      await rowOf(page, 1).waitFor({ state: "detached", timeout: 10000 });
      await page.waitForTimeout(300);
      const toastText = await page.locator("[data-sonner-toast]").allInnerTexts();
      check(`${T} 409 + row decided elsewhere: row disappears after the re-fetch, toast says "không còn chờ hoàn tiền", 1 POST`, toastText.join(" ").includes("không còn chờ hoàn tiền") && state.rcounts.resolve === 1 && (await rrows(page).count()) === 2, toastText.join("|"));
      await shot(page, `approve-409-row-gone-${tag}`);
      await ctx.close();
    }

    // ───────── 6. deny ─────────
    {
      const state = makeState();
      const { page, ctx } = await load(browser, { w, h, state });
      await openRow(page, 2);
      const deny = rowOf(page, 2).getByTestId("deny-refund-button");
      check(`${T} deny disabled without a note`, await deny.isDisabled());
      await rowOf(page, 2).getByLabel("Ghi chú quyết định").fill("Đã giao đủ bản nháp");
      await deny.click();
      const ad = page.getByRole("alertdialog");
      await ad.waitFor();
      check(`${T} deny needs a confirmation (no POST yet), shows the note`, state.rcounts.resolve === 0 && (await ad.innerText()).includes("Đã giao đủ bản nháp") && (await ad.innerText()).includes("Không có khoản tiền nào được hoàn"));
      await shot(page, `deny-confirm-${tag}`);
      await page.keyboard.press("Escape");
      await ad.waitFor({ state: "hidden" });
      check(`${T} Esc on deny dialog closes it, focus returns to the Từ chối button`, (await focusId(page)) === "deny-refund-button", await focusId(page));
      await deny.click();
      await page.getByTestId("refund-deny-dialog-confirm").click();
      await ad.waitFor({ state: "hidden" });
      check(`${T} deny: exactly 1 POST {decision:DENY,note}`, state.rcounts.resolve === 1 && JSON.parse(state.rbody).decision === "DENY" && JSON.parse(state.rbody).note === "Đã giao đủ bản nháp" && JSON.parse(state.rbody).refundAmount === undefined, state.rbody);
      await page.waitForTimeout(600);
      check(`${T} denied row left the list`, (await rowOf(page, 2).count()) === 0);
      await ctx.close();
    }
    {
      const state = makeState(); state.resolve = "500";
      const { page, ctx } = await load(browser, { w, h, state });
      await openRow(page, 3);
      await rowOf(page, 3).getByLabel("Ghi chú quyết định").fill("x");
      await rowOf(page, 3).getByTestId("deny-refund-button").click();
      await page.getByTestId("refund-deny-dialog-confirm").click();
      const de = page.getByTestId("refund-deny-dialog-error");
      await de.waitFor();
      await page.waitForTimeout(800);
      check(`${T} deny 500: 1 POST only (no retry), unknown-outcome message inside the dialog, confirm blocked, row still listed`, state.rcounts.resolve === 1 && (await txt(de)).includes("Chưa xác nhận được kết quả") && (await page.getByTestId("refund-deny-dialog-confirm").isDisabled()) && (await rowOf(page, 3).count()) === 1);
      await ctx.close();
    }

    // ───────── 7. calculation error / list errors / empty / loading / 403 / stale ─────────
    {
      const state = makeState(); state.calc = "500";
      const { page, ctx } = await load(browser, { w, h, state });
      await rowOf(page, 1).getByTestId("refund-row-toggle").click();
      await page.getByTestId("refund-calculation-error").waitFor({ timeout: 30000 });
      check(`${T} calculation 500 → error block with retry, no amount fields`, (await page.getByTestId("refund-calculation-error").getByRole("button", { name: "Thử lại" }).isVisible()) && (await page.getByTestId("refund-amount-input").count()) === 0);
      await shot(page, `calc-error-${tag}`);
      state.calc = "ok";
      await page.getByTestId("refund-calculation-error").getByRole("button", { name: "Thử lại" }).click();
      await page.getByTestId("refund-amount-input").waitFor();
      check(`${T} retry loads the real numbers`, (await txt(rowOf(page, 1))).includes("1.500.000"));
      await ctx.close();
    }
    for (const mode of ["500", "abort"]) {
      const state = makeState(); state.rflist = mode;
      const { page, ctx } = await load(browser, { w, h, state, wait: false });
      await page.getByTestId("refund-requests-error").waitFor({ timeout: 30000 });
      check(`${T} list ${mode} ≠ empty: error + "Không phải là “không có yêu cầu”", no empty text, no "0"`, (await page.getByTestId("admin-refunds-empty").count()) === 0 && (await txt(page.getByTestId("refund-requests-error"))).includes("không có yêu cầu") && (await page.getByTestId("admin-refunds-chip-count-service").count()) === 0);
      await shot(page, `load-error-${mode}-${tag}`);
      state.rflist = "ok";
      await page.getByRole("button", { name: "Thử lại" }).click();
      await rrows(page).first().waitFor();
      check(`${T} list ${mode}: retry recovers (3 rows)`, (await rrows(page).count()) === 3);
      await ctx.close();
    }
    {
      const state = makeState(); state.rflist = "403";
      const { page, ctx } = await load(browser, { w, h, state, wait: false });
      await page.getByTestId("refund-requests-error").waitFor({ timeout: 30000 });
      check(`${T} 403 → "Không có quyền xem", no retry button, no list`, (await txt(page.getByTestId("refund-requests-error"))).includes("Không có quyền xem") && (await page.getByTestId("refund-requests-error").getByRole("button").count()) === 0 && (await page.getByTestId("refund-requests-list").count()) === 0);
      await shot(page, `forbidden-${tag}`);
      await ctx.close();
    }
    {
      const state = makeState(); state.orders = [];
      const { page, ctx } = await load(browser, { w, h, state, wait: false });
      await page.getByTestId("admin-refunds-empty").waitFor();
      check(`${T} empty → "Không có yêu cầu hoàn tiền nào đang chờ xử lý", chip count 0, no table`, (await txt(page.getByTestId("admin-refunds-empty"))).includes("Không có yêu cầu hoàn tiền nào đang chờ xử lý") && (await txt(page.getByTestId("admin-refunds-chip-count-service"))) === "0" && (await page.getByTestId("refund-requests-list").count()) === 0);
      await shot(page, `empty-${tag}`);
      await ctx.close();
    }
    {
      const state = makeState(); state.delay = 4000;
      const env = await newPage(browser, { width: w, height: h, state });
      await env.page.goto(URL());
      await env.page.getByTestId("admin-refunds-loading").waitFor();
      check(`${T} loading → skeleton, no "0" count chip, no empty text`, (await env.page.getByTestId("admin-refunds-chip-count-service").count()) === 0 && (await env.page.getByTestId("admin-refunds-empty").count()) === 0);
      await shot(env.page, `loading-${tag}`);
      await env.ctx.close();
    }
    {
      const state = makeState();
      const { page, ctx } = await load(browser, { w, h, state, clock: true });
      await page.clock.fastForward(7 * 60_000);
      await page.waitForTimeout(400);
      const st = page.getByTestId("admin-refunds-stale");
      check(`${T} E-08 stale note after 7 min: "đã cũ 7 phút"`, (await st.isVisible()) && (await txt(st)).includes("đã cũ 7 phút"), await st.isVisible() ? await txt(st) : "hidden");
      await shot(page, `stale-${tag}`);
      state.rflist = "500";
      await page.getByTestId("admin-refunds-refresh").click();
      await page.waitForTimeout(2500);
      await page.clock.fastForward("00:02");
      await page.waitForTimeout(500);
      check(`${T} refresh failing with data on screen keeps the rows + "Không làm mới được"`, (await rrows(page).count()) === 3 && (await txt(page.getByTestId("admin-refunds-stale"))).includes("Không làm mới được") && (await page.getByTestId("refund-requests-error").count()) === 0);
      state.rflist = "ok";
      await page.getByTestId("admin-refunds-refresh").click();
      await page.waitForTimeout(1200);
      check(`${T} refresh succeeding clears the stale note`, (await page.getByTestId("admin-refunds-stale").count()) === 0);
      await ctx.close();
    }

    // ───────── 8. membership refund ─────────
    {
      const state = makeState(); state.mem = "slow";
      const { page, ctx } = await load(browser, { w, h, state, query: "?type=membership" });
      const idInput = page.getByTestId("membership-refund-id-input");
      await idInput.fill("not-a-uuid");
      await page.getByTestId("membership-refund-reason-select").selectOption("GYM_CLOSED");
      check(`${T} invalid UUID → inline error + open button disabled`, (await page.getByTestId("membership-refund-id-error").isVisible()) && (await page.getByTestId("membership-refund-open-button").isDisabled()));
      await shot(page, `membership-invalid-${tag}`);
      await idInput.fill(` ${GOOD_ID} `);
      const open = page.getByTestId("membership-refund-open-button");
      check(`${T} valid id + reason enables the button; no request yet`, !(await open.isDisabled()) && state.mcount === 0);
      await open.click();
      const md = page.getByTestId("membership-refund-dialog");
      await md.waitFor();
      const mt = await md.innerText();
      check(`${T} confirm dialog echoes exact id + reason, "ví khách hàng", server-computed amount NOT previewed, "Không thể hoàn tác"`,
        (await txt(md.getByTestId("membership-refund-dialog-id"))) === GOOD_ID && mt.includes("Phòng tập ngừng hoạt động") && mt.includes("ví khách hàng") && mt.includes("hệ thống tự tính") && mt.includes("chưa biết trước") && !mt.includes("₫") && mt.includes("Không thể hoàn tác"));
      await shot(page, `membership-dialog-${tag}`);
      if (tag === "390") { const o = await overflow(page); check(`${T} no overflow with membership dialog open`, o.sw <= o.cw, `${o.sw}/${o.cw}`); }
      const mc = md.getByTestId("membership-refund-dialog-confirm");
      await mc.dblclick();
      await mc.click({ force: true }).catch(() => {});
      await md.waitFor({ state: "hidden", timeout: 10000 });
      check(`${T} double click ⇒ exactly 1 POST {reason:GYM_CLOSED} to the pasted id`, state.mcount === 1 && state.mbody === JSON.stringify({ reason: "GYM_CLOSED" }) && state.mid === GOOD_ID, `${state.mcount} ${state.mbody} ${state.mid}`);
      const rc = page.getByTestId("membership-refund-last-result");
      await rc.waitFor();
      check(`${T} receipt only after server OK: 340.000 ₫ into client wallet + the id; form cleared`, (await txt(rc)).includes("340.000") && (await txt(rc)).includes(GOOD_ID) && (await idInput.inputValue()) === "");
      check(`${T} focus returned into the form after close (id input)`, (await focusId(page)) === "membership-refund-id-input", await focusId(page));
      await shot(page, `membership-receipt-${tag}`, { fullPage: true });
      await ctx.close();
    }
    for (const mode of ["500", "abort", "notfound"]) {
      const state = makeState(); state.mem = mode;
      const { page, ctx } = await load(browser, { w, h, state, query: "?type=membership" });
      await page.getByTestId("membership-refund-id-input").fill(GOOD_ID);
      await page.getByTestId("membership-refund-reason-select").selectOption("TRANSACTION_ERROR");
      await page.getByTestId("membership-refund-open-button").click();
      const md = page.getByTestId("membership-refund-dialog");
      await md.getByTestId("membership-refund-dialog-confirm").click();
      await md.getByTestId("membership-refund-dialog-error").waitFor();
      const e = await txt(md.getByTestId("membership-refund-dialog-error"));
      await page.waitForTimeout(800);
      check(`${T} membership ${mode}: inline error, 1 POST, no retry`, state.mcount === 1 && (await md.isVisible()), `${state.mcount} :: ${e}`);
      if (mode === "notfound") check(`${T} membership 404 → "Không tìm thấy gói hội viên", confirm can be retried only after editing`, e.includes("Không tìm thấy gói hội viên"), e);
      else check(`${T} membership ${mode} → unknown outcome + confirm blocked`, e.includes("Chưa xác nhận được kết quả") && (await md.getByTestId("membership-refund-dialog-confirm").isDisabled()), e);
      check(`${T} membership ${mode}: no success receipt shown`, (await page.getByTestId("membership-refund-last-result").count()) === 0);
      await ctx.close();
    }
    // dashboard smoke (the extracted card, same testids, same payload)
    {
      const state = makeState();
      const env = await newPage(browser, { width: w, height: h, state });
      const { page } = env;
      await page.goto(`${BASE}/admin/dashboard`);
      const idInput = page.getByTestId("membership-refund-id-input");
      await idInput.waitFor({ timeout: 30000 });
      await idInput.scrollIntoViewIfNeeded();
      await idInput.fill("not-a-uuid");
      await page.getByTestId("membership-refund-reason-select").selectOption("GYM_CLOSED");
      check(`${T} dashboard card: invalid UUID → error + disabled`, (await page.getByTestId("membership-refund-id-error").isVisible()) && (await page.getByTestId("membership-refund-open-button").isDisabled()));
      await idInput.fill(` ${GOOD_ID} `);
      await page.getByTestId("membership-refund-open-button").click();
      const md = page.getByTestId("membership-refund-dialog");
      await md.waitFor();
      check(`${T} dashboard card: confirmation echoes id + reason, no request yet`, (await txt(md.getByTestId("membership-refund-dialog-id"))) === GOOD_ID && state.mcount === 0 && (await md.innerText()).includes("Phòng tập ngừng hoạt động"));
      await md.getByTestId("membership-refund-dialog-confirm").click();
      await md.waitFor({ state: "hidden" });
      check(`${T} dashboard card: 1 POST {reason:GYM_CLOSED}`, state.mcount === 1 && state.mbody === JSON.stringify({ reason: "GYM_CLOSED" }), String(state.mbody));
      await shot(page, `dashboard-card-${tag}`);
      await env.ctx.close();
    }
  }

  // ───────── 9. keyboard, focus trap / Esc / return, axe (light 1440, light 390, dark 1440) ─────────
  for (const [w, h, tag, scheme] of [[1440, 900, "1440", "light"], [390, 844, "390", "light"], [1440, 900, "1440-dark", "dark"]]) {
    const T = `[${tag}]`;
    const { page, ctx } = await load(browser, { w, h, scheme });
    await axeCheck(`${T} refunds page, service chip (collapsed)`, page, ["#admin-main"]);
    await axeCheck(`${T} refunds page, whole document`, page, null);
    await prepare(page, 1, "1000000");
    await page.waitForTimeout(500);
    await axeCheck(`${T} refunds page, service chip, row expanded`, page, ["#admin-main"]);
    // approve dialog
    const approve = rowOf(page, 1).getByTestId("approve-refund-button");
    await approve.focus();
    await page.keyboard.press("Enter");
    const dlg = page.getByTestId("refund-approve-dialog");
    await dlg.waitFor();
    await page.waitForTimeout(600);
    await axeCheck(`${T} service approve dialog (danger confirm)`, page, ['[role="alertdialog"]']);
    check(`${T} focus trap: 16 Tab/Shift+Tab never leave the approve dialog`, await trapStaysInside(page));
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden" });
    await page.waitForTimeout(100);
    check(`${T} Esc closes approve dialog; focus returns to "Duyệt hoàn tiền"`, (await focusId(page)) === "approve-refund-button", await focusId(page));
    // 409 in dialog (error state) axe
    // deny dialog
    await rowOf(page, 1).getByTestId("deny-refund-button").click();
    await page.getByRole("alertdialog").waitFor();
    await page.waitForTimeout(500);
    await axeCheck(`${T} service deny dialog (MoneyActionDialog)`, page, ['[role="alertdialog"]']);
    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog").waitFor({ state: "hidden" });
    await chip(page, "membership").click();
    await page.getByTestId("admin-refunds-membership").waitFor();
    await page.waitForTimeout(500);
    await axeCheck(`${T} refunds page, membership chip`, page, ["#admin-main"]);
    await page.getByTestId("membership-refund-id-input").fill(GOOD_ID);
    await page.getByTestId("membership-refund-reason-select").selectOption("GYM_CLOSED");
    await page.getByTestId("membership-refund-open-button").focus();
    await page.keyboard.press("Enter");
    const md = page.getByTestId("membership-refund-dialog");
    await md.waitFor();
    await page.waitForTimeout(500);
    await axeCheck(`${T} membership dialog`, page, ['[role="alertdialog"]']);
    check(`${T} focus trap: membership dialog`, await trapStaysInside(page));
    await page.keyboard.press("Escape");
    await md.waitFor({ state: "hidden" });
    await page.waitForTimeout(100);
    check(`${T} Esc closes membership dialog; focus returns to the opener button`, (await focusId(page)) === "membership-refund-open-button", await focusId(page));
    if (scheme === "dark") await shot(page, `membership-dark-${tag}`, { fullPage: true });
    await ctx.close();

    // approve dialog with an inline error (error box styles) — 409 and 500
    for (const mode of ["409", "500"]) {
      const state = makeState(); state.resolve = mode;
      const r = await load(browser, { w, h, scheme, state });
      await prepare(r.page, 1, "1000000");
      await rowOf(r.page, 1).getByTestId("approve-refund-button").click();
      await r.page.getByTestId("refund-approve-dialog-confirm").click();
      await r.page.getByTestId("refund-approve-dialog-error").waitFor();
      await r.page.waitForTimeout(300);
      await axeCheck(`${T} approve dialog with ${mode} error box`, r.page, ['[role="alertdialog"]']);
      if (scheme === "dark" || tag === "1440") await shot(r.page, `approve-${mode}-axe-${tag}`);
      await r.ctx.close();
    }

    // ───── B5 withdrawals dialogs re-run (regression proof for the shared dialog fix) ─────
    const wenv = await newPage(browser, { width: w, height: h, state: makeState(), colorScheme: scheme });
    const wp = wenv.page;
    await wp.goto(`${BASE}/admin/finance/withdrawals`);
    await ready(wp);
    await wrows(wp).first().waitFor();
    await wp.waitForTimeout(250);
    await axeCheck(`${T} B5 withdrawals page (PENDING)`, wp, ["#admin-main"]);
    await wp.locator('[data-request-id$="000000000001"]').getByTestId("admin-withdrawal-approve-button").click();
    const ad = wp.getByTestId("admin-withdrawal-approve-dialog");
    await ad.waitFor();
    await wp.waitForTimeout(600);
    await axeCheck(`${T} B5 withdrawals APPROVE dialog (non-danger confirm)`, wp, ['[role="alertdialog"]']);
    if (scheme === "dark" || tag === "1440") await shot(wp, `b5-approve-dialog-${tag}`);
    check(`${T} B5 approve dialog: focus trap`, await trapStaysInside(wp));
    await wp.keyboard.press("Escape");
    await ad.waitFor({ state: "hidden" });
    await wp.locator('[data-request-id$="000000000003"]').getByTestId("admin-withdrawal-mark-paid-toggle").click();
    const pd = wp.getByTestId("admin-withdrawal-pay-dialog");
    await pd.waitFor();
    await pd.getByTestId("admin-withdrawal-bank-reference-input").fill("REF-1");
    await wp.waitForTimeout(600);
    await axeCheck(`${T} B5 withdrawals MARK-PAID dialog (bank-reference label inside)`, wp, ['[role="alertdialog"]']);
    if (scheme === "dark" || tag === "1440") await shot(wp, `b5-markpaid-dialog-${tag}`);
    check(`${T} B5 mark-paid dialog: confirm still disabled/enabled by the reference rule (enabled with ref)`, !(await pd.getByTestId("admin-withdrawal-pay-dialog-confirm").isDisabled()));
    await wp.keyboard.press("Escape");
    await pd.waitFor({ state: "hidden" });
    await wenv.ctx.close();
  }

  // ───────── 10. reduced motion ─────────
  {
    const state = makeState(); state.delay = 4000;
    const env = await newPage(browser, { width: 1440, height: 900, state, reducedMotion: true });
    await env.page.goto(URL());
    await env.page.getByTestId("admin-refunds-loading").waitFor();
    const anim = await env.page.evaluate(() => [...document.querySelectorAll('[data-testid="admin-refunds-loading"] .animate-pulse')].map((e) => getComputedStyle(e).animationName));
    check("[1440] prefers-reduced-motion ⇒ skeleton shimmer off", anim.length > 0 && anim.every((a) => a === "none"), anim.join(","));
    await env.ctx.close();
  }
  // clipboard copy
  {
    const { page, ctx } = await load(browser, { w: 1440, h: 900, clipboard: true });
    await rowOf(page, 1).getByTestId("admin-refund-copy-id").nth(2).click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check("[1440] copy button copies the FULL order id", clip === oid(1), clip);
    await ctx.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(`${OUT}/axe-results.json`, JSON.stringify(axeResults, null, 2));
  const { pass, total } = save(`${OUT}/mock-results.json`);
  process.exitCode = pass === total ? 0 : 1;
}
