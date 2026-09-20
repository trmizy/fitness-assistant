const { chromium } = require("D:/fitnessassistant-playwright-e2e/node_modules/playwright");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); p.setDefaultNavigationTimeout(120000); p.setDefaultTimeout(30000);
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const res = [];
  const chk = (n, ok, x = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n} ${x}`); };
  await p.goto("http://localhost:5173/login");
  await p.fill('input[type="email"], input[placeholder*="mail" i]', "admin@example.com");
  await p.fill('input[type="password"]', "password123");
  await p.getByRole("button", { name: /Đăng nhập/ }).first().click();
  await p.waitForURL("**/admin/**");
  await p.goto("http://localhost:5173/admin/partners");
  await p.getByRole("button", { name: "Đối tác", exact: true }).click();
  await p.locator('[data-testid="admin-partner-card"]').first().waitFor();
  const n = await p.locator('[data-testid="admin-partner-card"]').count();
  chk("legacy partner list still renders", n > 0, `cards=${n}`);
  chk("no 'Hồ sơ mới' create button", (await p.getByText("Hồ sơ mới").count()) === 0);
  const active = p.locator('[data-testid="admin-partner-card"]', { hasText: /Đang hoạt động|ACTIVE/i }).first();
  await (await active.count() ? active : p.locator('[data-testid="admin-partner-card"]').first()).click();
  await p.getByRole("button", { name: /Hành động/ }).waitFor();
  await p.getByRole("button", { name: /Hành động/ }).click();
  chk("partner detail has no 'Cấp tài khoản' action", (await p.getByRole("button", { name: /Cấp tài khoản/ }).count()) === 0);
  for (const tab of ["Tài khoản", "Giấy tờ", "Nhật ký"]) {
    const t = p.getByRole("button", { name: new RegExp(tab) }).first();
    if (await t.count()) { await t.click(); await p.waitForTimeout(600); }
  }
  chk("detail tabs render without JS errors", errs.length === 0, errs.slice(0, 2).join("|"));
  await b.close(); process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(2); });
