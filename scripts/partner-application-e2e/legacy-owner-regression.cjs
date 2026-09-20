// Hồi quy R1: chủ gym đã hoạt động TỪ TRƯỚC các thay đổi của phiên này vẫn dùng được bình thường.
// Rủi ro R1 = tách owner.routes.ts làm hai vùng + đổi nghĩa isLegacy, cả hai nằm trên đường đi của
// chủ gym thật. REAL BROWSER: đăng nhập → dashboard → tạo chi nhánh → xác nhận trong DB → dọn.
const { chromium } = require("D:/fitnessassistant-playwright-e2e/node_modules/playwright");
const { execSync } = require("node:child_process");
const path = require("path");
const fs = require("fs");

const WEB = "http://localhost:5173";
const EMAIL = "jane.smith@example.com";
const PASSWORD = "password123";
const OUT = path.join(require("os").tmpdir(), "legacy-owner-shots");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (n, ok, x = "") => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${x ? "  " + x : ""}`); };
const info = (...a) => console.log("   ·", ...a);
const sql = (q) => execSync(`docker exec gymcoach-postgres psql -U gymcoach -d gymcoach_gym -tAc "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();

(async () => {
  const branchName = `R1 Regression ${Date.now()}`;
  const before = sql(`select count(*) from gyms`);
  info("số chi nhánh trước khi chạy:", before);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(30000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const http4xx = [];
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api")) http4xx.push(`${r.status()} ${r.request().method()} ${r.url().split("/api")[1]}`); });

  // ── Đăng nhập ───────────────────────────────────────────────────────────────────────────
  await page.goto(WEB + "/login");
  await page.fill('input[type="email"], input[placeholder*="mail" i]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole("button", { name: /Đăng nhập/ }).first().click();
  await page.waitForURL("**/gym-owner/**", { timeout: 30000 });

  // ĐÂY LÀ RỦI RO R1: nếu isLegacy/cổng vận hành sai thì chủ gym cũ bị đẩy sang vùng ứng viên.
  check("chủ gym cũ KHÔNG bị đẩy sang /partner/application", !page.url().includes("/partner/application"), page.url());
  check("vào thẳng workspace chủ gym", page.url().includes("/gym-owner"), page.url());

  // ── Dashboard ───────────────────────────────────────────────────────────────────────────
  await page.goto(WEB + "/gym-owner/dashboard");
  await page.getByText("Doanh thu ví Gym").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "01-dashboard.png"), fullPage: true });
  const dash = await page.locator("body").innerText();
  check("dashboard tải được, có đủ 4 thẻ KPI", ["Doanh thu ví Gym", "Tổng hội viên Active", "Lượt Check-in hôm nay", "Điểm đánh giá trung bình"].every((k) => dash.includes(k)));
  check("dashboard không bị chặn bởi cổng vận hành", !/không có quyền|403|bị tạm khoá|chưa được duyệt/i.test(dash));

  // ── Các trang vận hành khác ─────────────────────────────────────────────────────────────
  for (const [p, marker] of [["/gym-owner/gyms", /Phòng gym|chi nhánh|Thêm chi nhánh|Create Gym/i], ["/gym-owner/plans", /Gói|plan/i], ["/gym-owner/managers", /Quản lý|manager/i]]) {
    await page.goto(WEB + p);
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    check(`mở được ${p}`, marker.test(body) && !/403|không có quyền/i.test(body));
  }

  // ── Tạo chi nhánh ───────────────────────────────────────────────────────────────────────
  await page.goto(WEB + "/gym-owner/gyms");
  await page.waitForTimeout(2500);
  const addBtn = page.getByText(/Thêm chi nhánh|Create Gym/).first();
  await addBtn.click();
  await page.getByPlaceholder("Gym name").waitFor({ timeout: 15000 });
  await page.getByPlaceholder("Gym name").fill(branchName);
  await page.getByPlaceholder("Address").fill("123 Duong R1 Regression");
  const city = page.getByPlaceholder("City");
  if (await city.count()) await city.fill("Can Tho");
  await page.screenshot({ path: path.join(OUT, "02-create-dialog.png") });

  // Bất biến 1 Owner = 1 Brand: hộp thoại KHÔNG được có ô chọn thương hiệu. Đếm tổng số <select>
  // là sai — hộp thoại vốn có hai ô tỉnh/phường, và thanh trên có ô đổi ngôn ngữ. Phải soi đúng
  // xem có select nào mang nghĩa "thương hiệu" không.
  const brandSelect = await page.evaluate(() =>
    [...document.querySelectorAll('select')].filter((el) => {
      const near = (el.closest('div')?.innerText ?? '') + ' ' + (el.getAttribute('aria-label') ?? '') + ' ' + (el.getAttribute('name') ?? '');
      return /thương hiệu|brand/i.test(near);
    }).length,
  );
  check("hộp thoại tạo chi nhánh không có bộ chọn thương hiệu", brandSelect === 0, `select mang nghĩa brand=${brandSelect}`);

  await page.getByRole("button", { name: /^(Tạo|Create|Lưu)/ }).last().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, "03-after-create.png"), fullPage: true });

  const row = sql(`select id||' | '||status||' | '||coalesce(brand_id,'(không brand)') from gyms where name='${branchName}'`);
  check("chi nhánh được tạo thật trong DB", row.length > 0, row);
  const gymId = row.split(" | ")[0];
  const status = row.split(" | ")[1];
  check("chi nhánh mới đi vào vòng duyệt bình thường, không tự APPROVED", status !== "APPROVED", `status=${status}`);
  const ownerBrand = sql(`select coalesce(brand_id,'') from gyms where id='${gymId}'`);
  const otherBrand = sql(`select coalesce(brand_id,'') from gyms where owner_id=(select owner_id from gyms where id='${gymId}') and id<>'${gymId}' and brand_id is not null limit 1`);
  check("chi nhánh mới thuộc ĐÚNG thương hiệu của chủ đó", ownerBrand.length > 0 && (otherBrand === "" || ownerBrand === otherBrand), `mới=${ownerBrand} cũ=${otherBrand}`);

  check("không có lỗi JS trong cả phiên", errs.length === 0, errs.slice(0, 2).join("|"));
  const known = http4xx.filter((x) => /404 GET \/owner\/brands\/.*\/plans/.test(x));
  const unexpected = http4xx.filter((x) => !known.includes(x));
  check("không có request hỏng nào ngoài lỗi đã biết", unexpected.length === 0, unexpected.slice(0, 3).join(" ; "));
  if (known.length) info("LỖI CÓ SẴN (không do phiên này):", known[0], "— GymOwnerDashboard truyền gymId vào listOwnedPlans(brandId)");

  // ── Dọn ─────────────────────────────────────────────────────────────────────────────────
  sql(`delete from gym_operating_hours where gym_id='${gymId}'`);
  sql(`delete from gyms where id='${gymId}'`);
  const after = sql(`select count(*) from gyms`);
  check("đã xoá chi nhánh thử, số lượng về như cũ", after === before, `trước=${before} sau=${after}`);

  console.log("\nẢnh:", OUT);
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} đạt`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR:", e.message.split("\n").slice(0, 6).join(" / ")); process.exit(2); });
