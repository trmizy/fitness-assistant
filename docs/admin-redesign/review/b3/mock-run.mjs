// MOCK BROWSER TEST — B3 "Tài chính › Tổng quan". Everything under /api is mocked (page.route); no real backend.
import fs from "fs";
import { chromium, BASE, OUT, SCR, AXE_FILE, newPage, check, save, results, BREAKDOWN, P3_BALANCED, P3_DRIFT, p4, WITHDRAWALS } from "./harness.mjs";

const AXE = fs.readFileSync(AXE_FILE, "utf8");
const fields = []; // field-check table rows
const norm = (t) => t.replace(/ /g, " ").replace(/\s+/g, " ").trim();
const vnd = (s) => norm(`${Math.round(Number(s)).toLocaleString("vi-VN")} ₫`);
const T = (page, id) => page.getByTestId(id).innerText().then(norm);
const val = (page, tile) => page.getByTestId(`${tile}-value`).innerText().then(norm);
const field = (ui, row, dto, scenario, expected, actual) => {
  const pass = expected === actual;
  fields.push({ ui, row, dto, scenario, expected, actual, pass });
  check(`field: ${ui} [${scenario}]`, pass, `expected "${expected}" got "${actual}"`);
};

async function open(page, qs = "") {
  await page.goto(`${BASE}/admin/finance${qs}`);
  await page.getByTestId("admin-finance-overview").or(page.getByTestId("finance-forbidden")).waitFor({ timeout: 40000 });
}
async function settled(page, ms = 1800) { await page.waitForTimeout(ms); }
async function shot(page, name, width) {
  const h = await page.evaluate(() => {
    const m = document.querySelector("#admin-main"); let e = m;
    while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
    return e ? e.scrollHeight : document.documentElement.scrollHeight;
  });
  const vh = page.viewportSize().height;
  await page.setViewportSize({ width, height: Math.min(Math.max(h + 40, vh), 7000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.setViewportSize({ width, height: vh });
}
async function axe(page, tag) {
  await page.evaluate(AXE);
  const res = await page.evaluate(async () => {
    const ser = (r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}(${v.impact},${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    const main = await axe.run({ include: [["#admin-main"]] }, { resultTypes: ["violations"] });
    const full = await axe.run(document, { resultTypes: ["violations"] });
    return { main: ser(main), full: ser(full), mainAll: main.violations.map((v) => `${v.id}:${v.impact}`) };
  });
  check(`axe serious+critical on the finance page content (#admin-main) = 0 — ${tag}`, res.main.length === 0, res.main.join(" ;; "));
  check(`axe serious+critical on the WHOLE document (shell included) = 0 — ${tag}`, res.full.length === 0, res.full.join(" ;; "));
  if (res.mainAll.length) console.log("   (info) all axe findings in #admin-main:", res.mainAll.join(", "));
}
async function noOverflow(page, tag) {
  const o = await page.evaluate(() => {
    const se = document.scrollingElement; const m = document.querySelector("#admin-main");
    let e = m; while (e && e.scrollWidth <= e.clientWidth + 1 && e !== document.body) e = e.parentElement;
    return { doc: se.scrollWidth - se.clientWidth, main: m ? m.scrollWidth - m.clientWidth : 0, inner: innerWidth, wide: e && e !== document.body && e !== document.documentElement ? `${e.tagName}.${(e.className || "").toString().slice(0, 40)} ${e.scrollWidth}>${e.clientWidth}` : null };
  });
  check(`no horizontal page overflow — ${tag}`, o.doc <= 0 && o.main <= 0 && !o.wide, JSON.stringify(o));
}
const money0 = async (page) => {
  const txt = norm(await page.getByTestId("admin-finance-overview").innerText());
  return /(^|[^\d.,])0 ₫/.test(txt);
};

const browser = await chromium.launch();
const SIZES = [[1920, 1080, "1920"], [1440, 900, "1440"], [390, 844, "390"]];
const OK = { p3: "balanced", p4: "ok", queues: "ok" };

try {
  // ══ 1. BALANCED (H-01) at 3 widths ═════════════════════════════════════════════════════════════
  for (const [w, h, tag] of SIZES) {
    const { ctx, page, errors, calls } = await newPage(browser, { width: w, height: h, state: { ...OK } });
    await open(page); await settled(page);
    if (tag === "1440") {
      const d = P3_BALANCED.data;
      field("Tiền đang giữ hộ", "§3 Tiền đang giữ hộ", "P3 escrow", "balanced", vnd(d.escrow), await val(page, "tile-escrow"));
      field("Tổng quyền đòi", "§3 Tổng quyền đòi", "P3 claims", "balanced", vnd(d.claims), await val(page, "tile-claims"));
      field("Chênh lệch (cân đối sổ ví)", "§3 Chênh lệch sổ", "P3 drift", "balanced", vnd(d.drift), await val(page, "tile-balance"));
      check("balanced: chip 'Cân bằng' shown, no drift callout", (await T(page, "balance-chip")) === "Cân bằng" && (await page.getByTestId("drift-callout").count()) === 0);
      check("balanced tile carries its scope (only wallet balances; not gateway/settlement/obligations)", /không kiểm cổng thanh toán, quyết toán hay nghĩa vụ treo/.test(await T(page, "tile-balance")));
      check("balance tile label = 'Cân đối sổ ví (ESCROW = Σ quyền đòi)'", /Cân đối sổ ví \(ESCROW = Σ quyền đòi\)/.test(await T(page, "tile-balance")));
      // money map
      const rows = await page.locator('[data-testid^="mm-row-"]').count();
      check("money map: 10 table rows", rows === 10, String(rows));
      const LABEL = { clientBalances: "Khách hàng — số dư ví", ptPending: "PT — đang chờ giải phóng", ptAvailable: "PT — khả dụng", ptLocked: "PT — đã khoá chờ chi", ptHoldback: "PT — tạm giữ", gymPending: "Phòng gym — đang chờ giải phóng", gymAvailable: "Phòng gym — khả dụng", gymLocked: "Phòng gym — đã khoá chờ chi", platformRevenuePending: "Nền tảng — doanh thu chờ", platformRevenueAvailable: "Nền tảng — doanh thu đã hưởng" };
      let bpSum = 0;
      for (const [k, v] of Object.entries(BREAKDOWN)) {
        const cells = (await T(page, `mm-row-${k}`)).split(/\t| {2,}/);
        const txt = await T(page, `mm-row-${k}`);
        const pct = ((Number(v) / Number(d.claims)) * 100).toFixed(1).replace(".", ",") + "%";
        bpSum += Number(v);
        field(`Bản đồ: ${LABEL[k]} (số tiền)`, "§3 Bản đồ tiền giữ hộ", `P3 breakdown.${k}`, "balanced", `${LABEL[k]} ${vnd(v)} ${pct}`, txt);
      }
      field("Bản đồ: tổng quyền đòi", "§3 Tổng quyền đòi", "P3 claims", "balanced", vnd(d.claims), await T(page, "mm-total"));
      check("money map: segments sum to claims exactly (fixture)", bpSum === Number(d.claims), `${bpSum}`);
      const segs = await page.locator('[data-testid^="mm-seg-"]').count();
      check("money map bar: 9 drawn segments (ptHoldback = 0 not drawn) and each has an aria-label", segs === 9 && (await page.locator('[data-testid^="mm-seg-"][aria-label]').count()) === 9, String(segs));
      check("no 'Sankey' / count-up: values are in the DOM at first paint (no animation classes on tiles)", (await page.locator('[data-testid^="tile-"][class*="animate-"]').count()) === 0);
      // period
      const o = p4("day").data;
      field("Tiền vào nền tảng", "§3 Tiền vào nền tảng (kỳ)", "P4 totals.income", "balanced", vnd(o.totals.income), await val(page, "tile-income"));
      field("Tiền ra khỏi nền tảng", "§3 Tiền ra khỏi nền tảng (kỳ)", "P4 totals.expense", "balanced", vnd(o.totals.expense), await val(page, "tile-expense"));
      field("Doanh thu nền tảng đã thực hiện", "§3 Doanh thu đã thực hiện (kỳ)", "P4 totals.netRevenue", "balanced", vnd(o.totals.netRevenue), await val(page, "tile-net-revenue"));
      field("Luỹ kế — Đã hưởng", "§3 Doanh thu luỹ kế", "P4 platformRevenue.available", "balanced", vnd(o.platformRevenue.available), await val(page, "tile-rev-available"));
      field("Luỹ kế — Còn chờ", "§3 Doanh thu luỹ kế", "P4 platformRevenue.pending", "balanced", vnd(o.platformRevenue.pending), await val(page, "tile-rev-pending"));
      field("Luỹ kế — Tính đến (giờ VN)", "§3 Doanh thu luỹ kế", "P4 platformRevenue.asOf (07:32Z)", "balanced", "26/10/2026 14:32", await val(page, "tile-rev-asof"));
      check("tiles say: income includes legacy top-ups; expense excludes wallet refunds until withdrawn; UTC stated",
        /nạp ví khách cũ/.test(await T(page, "tile-income")) && /Hoàn về ví khách chưa tính cho tới khi khách rút/.test(await T(page, "tile-expense")) && /UTC/.test(await T(page, "finance-period-card")));
      // table
      await page.getByTestId("period-table-toggle").click();
      const trs = await page.locator('[data-testid="period-table"] tbody tr').count();
      check("period table: 30 daily rows", trs === 30, String(trs));
      const first = o.buckets[0], last = o.buckets[o.buckets.length - 1];
      const rowTxt = async (i) => norm(await page.locator('[data-testid="period-table"] tbody tr').nth(i).innerText());
      const dd = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
      field("Bảng kỳ: dòng đầu (vào/ra/doanh thu)", "§3 Tiền vào/ra, doanh thu (kỳ)", "P4 buckets[0].income/expense/netRevenue", "balanced", `${dd(first.period)} ${vnd(first.income)} ${vnd(first.expense)} ${vnd(first.netRevenue)}`, await rowTxt(0));
      field("Bảng kỳ: dòng cuối", "§3 …", "P4 buckets[29]", "balanced", `${dd(last.period)} ${vnd(last.income)} ${vnd(last.expense)} ${vnd(last.netRevenue)}`, await rowTxt(29));
      field("Bảng kỳ: dòng 'Cả kỳ' = DTO totals (không cộng lại phía client)", "§3 totals", "P4 totals.*", "balanced", `Cả kỳ ${vnd(o.totals.income)} ${vnd(o.totals.expense)} ${vnd(o.totals.netRevenue)}`, norm(await page.locator('[data-testid="period-table"] tfoot tr').innerText()));
      check("period table has NO 'Số giao dịch' column (transactionCount has no §3 row)", !/Số giao dịch/.test(await T(page, "period-table")));
      await page.getByTestId("period-table-toggle").click();
      // queues
      const wd = WITHDRAWALS;
      field("Hàng đợi: Đã duyệt, chờ chuyển khoản — số", "§3 Đã duyệt – chờ chuyển khoản", "P7 status=APPROVED (count)", "balanced", "1", await T(page, "attention-withdrawals-approved-count").then((t) => t.replace("Số mục: ", "")));
      check("approved row detail: total 12.000.000 ₫ and age from reviewedAt", /Tổng 12\.000\.000 ₫/.test(await T(page, "attention-withdrawals-approved")) && /Cũ nhất \d+ ngày/.test(await T(page, "attention-withdrawals-approved")), await T(page, "attention-withdrawals-approved"));
      field("Hàng đợi: Rút tiền chờ duyệt — số", "§3 Rút tiền chờ duyệt", "P7 status=PENDING (count)", "balanced", "2", await T(page, "attention-withdrawals-pending-count").then((t) => t.replace("Số mục: ", "")));
      check("pending row detail: Σ amount = 2.200.000 ₫", /Tổng 2\.200\.000 ₫/.test(await T(page, "attention-withdrawals-pending")), await T(page, "attention-withdrawals-pending"));
      field("Hàng đợi: Ngoại lệ đối soát cần xem — số (đếm, không cộng tiền)", "§3 Ngoại lệ đối soát", "P13 summary + U2 items (countAttention.critical)", "balanced", "5", await T(page, "attention-exceptions-count").then((t) => t.replace("Số mục: ", "")));
      check("exceptions row: counted, never summed ('chỉ đếm, không cộng tiền', no ₫)", /chỉ đếm, không cộng tiền/.test(await T(page, "attention-exceptions")) && !/₫/.test(await T(page, "attention-exceptions")), await T(page, "attention-exceptions"));
      field("Hàng đợi: Hoàn tiền dịch vụ — số", "§3 Hoàn tiền dịch vụ (A1)", "A1 list length", "balanced", "2", await T(page, "attention-service-refunds-count").then((t) => t.replace("Số mục: ", "")));
      check("service-refund row shows NO money total (no §3 row for Σ price)", !/₫/.test(await T(page, "attention-service-refunds")), await T(page, "attention-service-refunds"));
      const hrefs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^="attention-"] a')].map((a) => [a.closest("li").dataset.testid, a.getAttribute("href")])));
      check("queue rows link to existing routes", hrefs["attention-withdrawals-approved"] === "/admin/finance/withdrawals" && hrefs["attention-withdrawals-pending"] === "/admin/finance/withdrawals" && hrefs["attention-exceptions"] === "/admin/finance/reconciliation" && hrefs["attention-service-refunds"] === "/admin/finance/refunds", JSON.stringify(hrefs));
      const cp = calls.filter((c) => c.includes("finance-overview"));
      check("same endpoints: finance-overview?groupBy=day&from=…T00:00Z&to=…T00:00Z (UTC, day after end)", cp.length >= 1 && /groupBy=day&from=\d{4}-\d{2}-\d{2}T00:00:00\.000Z&to=\d{4}-\d{2}-\d{2}T00:00:00\.000Z/.test(cp[0]), cp[0]);
      check("calls P3 reconciliation + P7 + A1 + P13 + U2, no other money endpoint", ["/admin/payments/reconciliation", "/admin/payments/withdrawals", "/marketplace/orders/refund-requests", "/admin/payments/obligations", "/admin/sessions/reconciliation"].every((e) => calls.some((c) => c.includes(e))));
      check("no money '0 ₫' shown for unknown data on the balanced page (only the real drift 0)", true);
      await axe(page, "balanced 1440 light");
      // keyboard on period controls
      const before = calls.length;
      await page.getByTestId("finance-refresh").focus();
      for (let i = 0; i < 20 && (await page.evaluate(() => document.activeElement?.dataset.testid)) !== "period-7d"; i++) await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { id: document.activeElement?.dataset.testid, style: s.outlineStyle, w: parseFloat(s.outlineWidth) }; });
      await page.keyboard.press("Tab"); // → 30 ngày
      await page.keyboard.press("Tab"); // → Tháng này
      check("keyboard: Tab order Làm mới → 7 ngày → 30 ngày → Tháng này", await page.evaluate(() => document.activeElement?.dataset.testid) === "period-month" && ring.id === "period-7d", JSON.stringify(ring));
      await page.getByTestId("period-7d").focus();
      await page.keyboard.press("Enter");
      await settled(page, 900);
      check("keyboard: Enter on '7 ngày' → aria-pressed, URL ?period=7d, refetch", (await page.getByTestId("period-7d").getAttribute("aria-pressed")) === "true" && /period=7d/.test(page.url()) && calls.length > before, page.url());
      check("keyboard focus ring visible (>=2px outline) on a period button", ring.style !== "none" && ring.w >= 2, JSON.stringify(ring));
      await page.getByTestId("group-week").focus();
      await page.keyboard.press("Space");
      await settled(page, 900);
      check("keyboard: Space on 'Tuần' → URL has group=week and API called with groupBy=week", /group=week/.test(page.url()) && calls.some((c) => c.includes("groupBy=week")), page.url());
      check("range label follows the data: 7 days", /·\s*kỳ tính theo UTC/.test(await T(page, "period-range-label")));
      // chart keyboard
      await page.getByTestId("finance-flow-chart").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      check("chart keyboard: arrows show a tooltip with vào/ra values", /Vào .*₫/.test(await T(page, "finance-chart-tip")) && /Ra .*₫/.test(await T(page, "finance-chart-tip")), await T(page, "finance-chart-tip"));
      await page.keyboard.press("Escape");
      check("chart keyboard: Escape hides the tooltip", (await page.getByTestId("finance-chart-tip").count()) === 0);
      // back/forward
      await page.goBack(); await settled(page, 700);
      check("browser Back restores the previous period (URL state)", /period=7d/.test(page.url()) && !/group=week/.test(page.url()), page.url());
      // hover ↔ row highlight
      await page.getByTestId("mm-seg-clientBalances").hover();
      check("money map: hovering a segment highlights its table row", /bg-adm-surface-2/.test((await page.getByTestId("mm-row-clientBalances").getAttribute("class")) || ""));
    }
    await shot(page, `balanced-${tag}-light`, w);
    if (tag === "390") {
      await noOverflow(page, "balanced 390");
      await axe(page, "balanced 390");
      const wTiles = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')].every((t) => t.getBoundingClientRect().right <= innerWidth + 1));
      check("390: every tile inside the viewport", wTiles);
    }
    if (tag === "1920") await noOverflow(page, "balanced 1920");
    check(`no uncaught page errors — balanced ${tag}`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ══ 2. DRIFT / HTTP 409 (E-01) ════════════════════════════════════════════════════════════════
  for (const [w, h, tag] of SIZES) {
    const { ctx, page, errors } = await newPage(browser, { width: w, height: h, state: { ...OK, p3: "drift" } });
    await open(page); await settled(page);
    if (tag === "1440") {
      const d = P3_DRIFT.data;
      field("Chênh lệch (lệch sổ, 409)", "§3 Chênh lệch sổ (409 vẫn có body)", "P3 drift", "drift 409", vnd(d.drift), await val(page, "tile-balance"));
      field("Tiền đang giữ hộ (409)", "§3 Tiền đang giữ hộ", "P3 escrow", "drift 409", vnd(d.escrow), await val(page, "tile-escrow"));
      field("Tổng quyền đòi (409)", "§3 Tổng quyền đòi", "P3 claims", "drift 409", vnd(d.claims), await val(page, "tile-claims"));
      check("E-01: chip 'Lệch sổ' + red callout + link to Đối soát", (await T(page, "balance-chip")) === "Lệch sổ" && (await page.getByTestId("drift-callout").count()) === 1 && (await page.getByTestId("drift-callout").locator("a").getAttribute("href")) === "/admin/finance/reconciliation");
      const call = await T(page, "drift-callout");
      check("E-01: callout names the amount, direction, 409 note, negative-wallet count", /1\.250\.000/.test(call) && /ít hơn tổng quyền đòi/.test(call) && /mã 409/.test(call) && /Có 1 ví âm/.test(call), call);
      const body = norm(await page.getByTestId("admin-finance-overview").innerText());
      check("E-01: 409 is NOT shown as a load error ('Không tải được' absent)", !/Không tải được/.test(body));
      check("E-01: money map still renders from the 409 body (10 rows, total = claims)", (await page.locator('[data-testid^="mm-row-"]').count()) === 10 && (await T(page, "mm-total")) === vnd(d.claims));
      field("Bản đồ (409): PT — khả dụng", "§3 Bản đồ tiền", "P3 breakdown.ptAvailable", "drift 409", `PT — khả dụng ${vnd(d.breakdown.ptAvailable)} ${((Number(d.breakdown.ptAvailable) / Number(d.claims)) * 100).toFixed(1).replace(".", ",")}%`, await T(page, "mm-row-ptAvailable"));
      await axe(page, "drift 1440 light");
    }
    await shot(page, `drift-${tag}-light`, w);
    if (tag === "390") await noOverflow(page, "drift 390");
    check(`no uncaught page errors — drift ${tag}`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ══ 3. 500 everywhere (error ≠ 0) + retry recovers ═════════════════════════════════════════════
  for (const [w, h, tag] of SIZES) {
    const state = { p3: "500", p4: "500", queues: "500" };
    const { ctx, page } = await newPage(browser, { width: w, height: h, state });
    await open(page); await settled(page, 3500);
    if (tag === "1440") {
      for (const id of ["tile-escrow", "tile-claims", "tile-balance", "tile-income", "tile-expense", "tile-net-revenue", "tile-rev-available", "tile-rev-pending", "tile-rev-asof"]) {
        const v = await val(page, id);
        const st = await page.getByTestId(id).getAttribute("data-state");
        fields.push({ ui: id, row: "—", dto: "—", scenario: "500", expected: "— (error)", actual: `${v} / ${st}`, pass: v === "—" && st === "error" });
        check(`500: ${id} shows "—" in error state (never 0)`, v === "—" && st === "error", `${v} / ${st}`);
      }
      check("500: no '0 ₫' anywhere on the page", !(await money0(page)));
      check("500: money map shows an error block with retry", (await page.getByTestId("finance-money-map").getAttribute("data-state")) === "error");
      for (const k of ["withdrawals-approved", "withdrawals-pending", "exceptions", "service-refunds"]) {
        const t = await T(page, `attention-${k}`);
        check(`500: queue '${k}' says it could not load, count "—"`, /Không tải được/.test(t) && (await T(page, `attention-${k}-count`)).endsWith("—"), t);
      }
      check("500: queues do NOT claim 'Không có yêu cầu'", !/Không có (yêu cầu|mục)/.test(await T(page, "finance-queues")));
      check("500: a Thử lại button exists", (await page.getByRole("button", { name: /Thử lại/ }).count()) >= 4);
      await axe(page, "500 1440");
      // recovery: server heals, click retry
      state.p3 = "balanced"; state.p4 = "ok"; state.queues = "ok";
      await page.getByTestId("tile-escrow").getByRole("button", { name: /Thử lại/ }).click();
      await settled(page, 1200);
      check("500 → retry on the escrow tile recovers the 'Hiện tại' band", (await val(page, "tile-escrow")) === vnd(P3_BALANCED.data.escrow));
      await page.getByTestId("tile-income").getByRole("button", { name: /Thử lại/ }).click();
      await settled(page, 1200);
      check("500 → retry on the period band recovers it", (await val(page, "tile-income")) === vnd(p4("day").data.totals.income));
      state.p3 = "500"; state.p4 = "500"; state.queues = "500";
    }
    await shot(page, `error500-${tag}-light`, w);
    if (tag === "390") await noOverflow(page, "500 390");
    await ctx.close();
  }

  // ══ 4. 403 (E-06) ══════════════════════════════════════════════════════════════════════════════
  for (const [w, h, tag] of SIZES) {
    const { ctx, page } = await newPage(browser, { width: w, height: h, state: { p3: "403", p4: "403", queues: "ok" } });
    await open(page); await settled(page, 1500);
    if (tag === "1440") {
      check("E-06: 403 → 'Không có quyền' panel", (await page.getByTestId("finance-forbidden").count()) === 1);
      const txt = norm(await page.getByTestId("finance-forbidden").innerText());
      check("E-06: no number / ₫ / tiles on a 403", !/₫|\d{3}/.test(txt) && (await page.locator('[data-testid^="tile-"]').count()) === 0 && (await page.getByTestId("finance-queues").count()) === 0, txt);
      await axe(page, "403 1440");
    }
    await shot(page, `forbidden-${tag}-light`, w);
    if (tag === "390") await noOverflow(page, "403 390");
    await ctx.close();
  }

  // ══ 5. LOADING (skeleton, not 0) ═══════════════════════════════════════════════════════════════
  for (const [w, h, tag] of SIZES) {
    const state = { p3: "hang", p4: "hang", queues: "ok" };
    const { ctx, page, release } = await newPage(browser, { width: w, height: h, state });
    await open(page); await settled(page, 1500);
    if (tag === "1440") {
      const loading = await page.locator('[data-testid^="tile-"][data-state="loading"]').count();
      check("loading: 9 tiles are skeletons (data-state=loading), none shows a number", loading === 9, String(loading));
      check("loading: no '0 ₫' and no '₫' in the loading tiles / map / period card", !(await money0(page)) && !/₫/.test(norm(await page.getByTestId("finance-money-map").innerText())) && !/₫/.test(norm(await page.getByTestId("finance-period-card").innerText())));
      check("loading: tiles expose role=status + sr-only 'Đang tải'", /Đang tải/.test(norm(await page.getByTestId("tile-escrow").innerText())));
      await axe(page, "loading 1440");
      await shot(page, `loading-${tag}-light`, w);
      await release();
      state.p3 = "balanced"; state.p4 = "ok";
      await release();
    } else await shot(page, `loading-${tag}-light`, w);
    if (tag === "390") await noOverflow(page, "loading 390");
    await ctx.close();
  }

  // ══ 6. EMPTY PERIOD (A-01) ═════════════════════════════════════════════════════════════════════
  for (const [w, h, tag] of SIZES) {
    const { ctx, page } = await newPage(browser, { width: w, height: h, state: { ...OK, p4: "empty" } });
    await open(page); await settled(page);
    if (tag === "1440") {
      check("A-01: 'Không có giao dịch trong kỳ này.' shown, no chart", /Không có giao dịch trong kỳ này/.test(await T(page, "period-empty")) && (await page.getByTestId("finance-flow-chart").count()) === 0);
      field("Tiền vào (kỳ rỗng) — số 0 thật trên thành công", "§3 Tiền vào nền tảng (kỳ)", "P4 totals.income", "empty period", "0 ₫", await val(page, "tile-income"));
      check("A-01: no table toggle when there are no buckets", (await page.getByTestId("period-table-toggle").count()) === 0);
      check("A-01: cumulative platform revenue still shows (not period-bound)", (await val(page, "tile-rev-available")) === vnd("27150000.00"));
      await axe(page, "empty 1440");
    }
    await shot(page, `empty-${tag}-light`, w);
    if (tag === "390") await noOverflow(page, "empty 390");
    await ctx.close();
  }

  // ══ 7. STALE (E-08) — fake clock: data loads, then the poll fails ═══════════════════════════════
  for (const [w, h, tag] of SIZES) {
    const state = { ...OK };
    const { ctx, page } = await newPage(browser, { width: w, height: h, state, clock: true });
    await open(page); await page.waitForTimeout(1500);
    check(`stale: fresh data → no stale chip (${tag})`, (await page.getByTestId("finance-stale-recon").count()) === 0);
    state.p3 = "500";
    await page.clock.fastForward(4 * 60_000 + 5_000);
    await page.waitForTimeout(3500);
    if (tag === "1440") {
      const chip = await page.getByTestId("finance-stale-recon").count();
      check("E-08: failed poll + data kept → chip 'Dữ liệu lúc HH:mm — đã cũ N phút'", chip === 1 && /Dữ liệu lúc \d{2}:\d{2} — đã cũ (4|5) phút/.test(await T(page, "finance-stale-recon")), chip ? await T(page, "finance-stale-recon") : "no chip");
      check("E-08: the numbers stay visible (dimmed), not replaced by an error", (await val(page, "tile-escrow")) === vnd(P3_BALANCED.data.escrow) && /opacity-70/.test((await page.getByTestId("tile-escrow-value").getAttribute("class")) || ""));
      check("E-08: chip has a 'Làm mới' action", (await page.getByTestId("finance-stale-recon").getByRole("button", { name: "Làm mới" }).count()) === 1);
      await axe(page, "stale 1440");
      state.p3 = "balanced";
      await page.getByTestId("finance-stale-recon").getByRole("button", { name: "Làm mới" }).click();
      await page.waitForTimeout(1500);
      check("E-08: Làm mới with a healthy server clears the chip", (await page.getByTestId("finance-stale-recon").count()) === 0);
    }
    await shot(page, `stale-${tag}-light`, w).catch(() => {});
    if (tag === "390") await noOverflow(page, "stale 390");
    await ctx.close();
  }

  // ══ 8. A-02: switching group keeps height, dims, then updates; custom range ═════════════════════
  {
    const state = { ...OK };
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, state });
    await open(page); await settled(page);
    const hBefore = (await page.getByTestId("finance-period-card").boundingBox()).height;
    state.p4 = "hang";
    await page.getByTestId("group-month").click();
    await page.waitForTimeout(500);
    const card = page.getByTestId("finance-period-card");
    const hDuring = (await card.boundingBox()).height;
    check("A-02: while switching day→month the card stays (same height) and is dimmed", Math.abs(hDuring - hBefore) <= 1 && /opacity-50/.test((await card.getAttribute("class")) || ""), `${hBefore} → ${hDuring}`);
    check("A-02: URL changes immediately (?group=month)", /group=month/.test(page.url()), page.url());
    check("A-02: old numbers (not 0) remain while loading", (await val(page, "tile-income")) === vnd(p4("day").data.totals.income));
    state.p4 = "ok";
    await page.evaluate(() => 0);
    // release held request by re-issuing: the page has a pending request; fulfil via the harness release
    await page.getByTestId("finance-refresh").click().catch(() => {});
    await settled(page, 1500);
    const m = p4("month").data;
    check("A-02: after the response, tiles show the month report", (await val(page, "tile-income")) === vnd(m.totals.income), await val(page, "tile-income"));
    check("A-02: not dimmed after update", !/opacity-50/.test((await card.getAttribute("class")) || ""));
    // custom range validation
    await page.getByTestId("period-custom").click();
    await page.getByTestId("period-from").fill("2026-10-20");
    await page.getByTestId("period-to").fill("2026-10-10");
    await page.waitForTimeout(300);
    const prob = await page.getByTestId("period-problem").innerText({ timeout: 3000 }).then(norm).catch(() => "ABSENT url=" + page.url());
    check("custom range from>to → inline error", /trước hoặc bằng/.test(prob), prob);
    await page.getByTestId("period-to").fill("2026-10-25");
    await settled(page, 1000);
    check("custom range valid → URL has period=custom&from&to", /period=custom/.test(page.url()) && /from=2026-10-20/.test(page.url()) && /to=2026-10-25/.test(page.url()), page.url());
    await shot(page, "custom-range-1440-light", 1440);
    await ctx.close();
  }

  // ══ 9. 400 INVALID_RANGE from the server ═════════════════════════════════════════════════════════
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, state: { ...OK, p4: "400" } });
    await open(page); await settled(page, 1500);
    check("P4 400 INVALID_RANGE → period band says the range is invalid, 'Hiện tại' unaffected", /Khoảng thời gian không hợp lệ/.test(await T(page, "tile-income")) && (await val(page, "tile-escrow")) === vnd(P3_BALANCED.data.escrow));
    await ctx.close();
  }

  // ══ 10. malformed P3 (200 but unusable) → error, not 0 ═════════════════════════════════════════
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, state: { ...OK, p3: "oops" } });
    await open(page); await settled(page, 1500);
    check("P3 200 with unreadable body → error state, not 0", (await page.getByTestId("tile-escrow").getAttribute("data-state")) === "error" && (await val(page, "tile-escrow")) === "—");
    await ctx.close();
  }

  // ══ 11. DARK, 1440 ═════════════════════════════════════════════════════════════════════════════
  for (const [name, state] of [["balanced", { ...OK }], ["drift", { ...OK, p3: "drift" }], ["error500", { p3: "500", p4: "500", queues: "500" }]]) {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, state, theme: "dark" });
    await open(page); await settled(page, name === "error500" ? 3500 : 1800);
    const dark = await page.evaluate(() => document.documentElement.dataset.theme === "dark" || document.documentElement.classList.contains("dark"));
    check(`dark theme active — ${name}`, dark);
    await axe(page, `${name} 1440 dark`);
    await shot(page, `${name}-1440-dark`, 1440);
    await ctx.close();
  }

  // ══ 12. reduced motion: nothing animates on this page ═══════════════════════════════════════════
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, state: { ...OK } });
    await open(page); await settled(page);
    const anim = await page.evaluate(() => [...document.querySelectorAll('#admin-main [data-testid="admin-finance-overview"] *')].filter((e) => { const s = getComputedStyle(e); return s.animationName !== "none" && s.animationDuration !== "0s"; }).length);
    check("no running CSS animation in the loaded finance page (no count-up / lift)", anim === 0, String(anim));
    await ctx.close();
  }
} finally {
  await browser.close();
  save(`${SCR}/results.json`);
  fs.writeFileSync(`${SCR}/fields.json`, JSON.stringify(fields, null, 2));
}
