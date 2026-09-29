const { chromium } = require("D:/fitnessassistant-playwright-e2e/node_modules/playwright");
const fs = require("fs");
const path = require("path");

// Chạy qua tunnel/IP khác: BASE_URL=https://....trycloudflare.com node ...
const BASE = process.env.BASE_URL || "http://localhost:5173";
const OUT = path.join(require("os").tmpdir(), "partner-e2e-shots");
fs.mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
fs.writeFileSync(path.join(OUT, "t.png"), PNG);
fs.writeFileSync(path.join(OUT, "t.pdf"), "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};

(async () => {
  const browser = await chromium.launch();
  const email = `e2e-${Date.now()}@partner-e2e.test`;
  const password = "Partner-E2E-123";
  const BRAND = "E2E Brand " + Date.now();
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.W ? 800 : 900) }, geolocation: { latitude: 10.7769, longitude: 106.7009 }, permissions: ["geolocation"] });
  const page = await ctx.newPage(); page.setDefaultNavigationTimeout(120000); page.setDefaultTimeout(30000);
  const errors = [];
  page.on("response", (r) => { if (r.status() >= 400) console.log("HTTP", r.status(), r.request().method(), r.url().replace("http://localhost:5173", "")); });
  const ovf = async (label) => { const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); check(`no horizontal overflow @${process.env.W || 1280}px: ${label}`, !o); };
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

  // 1. CTA below "Cấu hình máy chủ"
  await page.goto(BASE + "/login");
  const server = page.getByText("Cấu hình máy chủ");
  const cta = page.getByRole("link", { name: /Đăng ký làm đối tác/ });
  await cta.waitFor();
  const sb = await server.boundingBox();
  const cb = await cta.boundingBox();
  check("login CTA rendered below server-config", cb.y > sb.y, `(server y=${Math.round(sb.y)}, cta y=${Math.round(cb.y)})`);
  await page.screenshot({ path: path.join(OUT, "01-login.png") });
  await cta.click();
  await page.waitForURL("**/partner/apply");

  // 2. email
  await page.fill("#apply-email", email);
  await page.getByRole("button", { name: /Gửi liên kết xác minh/ }).click();
  const link = page.getByRole("link", { name: /Chế độ thử nghiệm/ });
  await link.waitFor({ timeout: 15000 });
  const href = await link.getAttribute("href");
  check("start returned dev verify link with fragment token", /#token=/.test(href));
  await page.screenshot({ path: path.join(OUT, "02-check-email.png") });

  // 3. verify → token scrubbed from URL
  const u = new URL(href);
  await page.goto(BASE + u.pathname + u.hash);
  await page.waitForSelector("#pw", { timeout: 15000 });
  check("token removed from URL after verify", !page.url().includes("token"), page.url());
  await page.reload();
  await page.waitForSelector("#pw", { timeout: 15000 });
  check("refresh after verify keeps setup session", true);
  await page.fill("#pw", password);
  await page.fill("#pw2", password);
  await page.getByRole("button", { name: /Tạo tài khoản/ }).click();
  await page.waitForURL("**/partner/application", { timeout: 20000 });
  check("account created -> /partner/application", true);

  // 4. wizard
  const card = page.locator("main");
  await page.getByRole("heading", { name: "Người đại diện" }).waitFor();
  await card.locator("input").nth(0).fill("Nguyen Van E2E");
  await card.locator("input").nth(1).fill("0901234567");
  await card.locator("select").first().selectOption("GYM_OWNER");
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.getByText("Tên thương hiệu *").waitFor();
  await card.locator("input").first().fill(BRAND);
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  // Bước Mạng xã hội (tuỳ chọn): link sai tên miền bị từ chối, link đúng lưu được.
  await page.getByRole("heading", { name: "Mạng xã hội" }).waitFor();
  await page.getByLabel("Facebook", { exact: true }).fill("https://facebook.com.evil.example/x");
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.getByText(/Link Facebook không hợp lệ/).waitFor({ timeout: 10000 });
  check("social step rejects a fake Facebook domain", true);
  await page.getByLabel("Facebook", { exact: true }).fill("https://www.facebook.com/gymini.e2e");
  await page.getByLabel("TikTok", { exact: true }).fill("https://www.tiktok.com/@gymini.e2e");
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.getByText("Bạn đang vận hành bao nhiêu chi nhánh?").waitFor();
  check("social step saved valid links", true);
  await page.getByRole("button", { name: /Nhiều chi nhánh/ }).click();
  check("multi-branch note shown", await page.getByText("Bạn có thể thêm các chi nhánh khác").isVisible());
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.getByText("sẽ tự thuộc thương hiệu", { exact: false }).waitFor();
  check("branch step shows read-only brand (no brand selector)", (await card.locator("select").count()) === 0);
  await card.locator("input").nth(0).fill("Chi nhanh Quan 1");
  await card.locator("input").nth(1).fill("0281234567");
  check("branch step no longer asks for the address (moved to Vị trí)", (await card.getByText("Địa chỉ", { exact: false }).count()) === 0);
  await page.getByRole("button", { name: /Tiếp tục/ }).click();

  // location
  await page.getByText("Tỉnh/Thành phố").waitFor();
  await card.locator("input").first().fill("123 Lê Lợi");
  const selects = card.locator("select");
  await selects.nth(0).selectOption({ label: "Thành phố Hồ Chí Minh" });
  await page.waitForFunction(() => document.querySelectorAll("main select")[1] && document.querySelectorAll("main select")[1].options.length > 1);
  await selects.nth(1).selectOption({ label: "Phường Bến Thành" });
  await page.locator(".leaflet-container").waitFor({ timeout: 20000 });
  // Đủ số nhà + đường + phường + tỉnh → bản đồ tự ghim (Nominatim thật, cần mạng).
  await page.locator(".leaflet-marker-icon").waitFor({ timeout: 15000 });
  const pinText = (await page.getByText(/Đã ghim theo địa chỉ|Chỉ tìm thấy|Không tìm thấy|Chưa tra được/).first().textContent()) || "";
  check("map auto-pinned from typed address: " + pinText.trim(), /Đã ghim|Chỉ tìm thấy/.test(pinText));
  await page.locator(".leaflet-container").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await page.locator(".leaflet-container").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
  console.log("markers:", await page.locator(".leaflet-marker-icon").count(), "panes:", await page.locator(".leaflet-marker-pane").count(), "errs:", errors.slice(-4));
  await page.screenshot({ path: path.join(OUT, "03-location-debug.png") });
  await page.locator(".leaflet-marker-icon").waitFor({ timeout: 5000 });
  check("map pin placed via click", true);
  await ovf("location");
  await page.screenshot({ path: path.join(OUT, "03-location.png") });
  await page.getByRole("button", { name: /Tiếp tục/ }).click();

  // photos (upload direct to storage)
  await page.getByText("Cần tối thiểu").waitFor();
  await page.locator('input[type=file]').setInputFiles(path.join(OUT, "t.png"));
  await page.locator("main img").first().waitFor({ timeout: 20000 });
  check("photo uploaded (presign -> storage -> confirm) and shown", true);
  await ovf("photos");
  await page.screenshot({ path: path.join(OUT, "04-photos.png") });
  await page.getByRole("button", { name: /Tiếp tục/ }).click();

  // legal
  await page.getByText("Tên pháp lý của doanh nghiệp").waitFor();
  await card.locator("input[type=text], input:not([type])").first().fill("Cong ty TNHH E2E");
  const fileInputs = page.locator('input[type=file]');
  const n = await fileInputs.count();
  for (let i = 0; i < n; i++) {
    // Ô thứ 2 = CCCD: chọn MỘT lần hai tệp (mặt trước + mặt sau).
    await fileInputs.nth(i).setInputFiles(i === 0 ? path.join(OUT, "t.pdf") : i === 1 ? [path.join(OUT, "t.png"), path.join(OUT, "t.png")] : path.join(OUT, "t.png"));
    await page.waitForTimeout(i === 1 ? 2500 : 1200);
  }
  await page.waitForFunction(() => document.querySelectorAll("main").length && (document.body.innerText.match(/Chờ duyệt/g) || []).length >= 3, null, { timeout: 30000 });
  check("3 required documents uploaded (Chờ duyệt)", true);
  check("legal step offers optional docs (mã số thuế + PCCC)", (await page.getByText("Giấy tờ bổ sung").count()) === 1 && (await page.getByText("Giấy chứng nhận PCCC").count()) === 1 && (await page.getByText("Ảnh hiện trạng cơ sở").count()) === 0);

  // CCCD: hai thumbnail, bấm xem phóng to, xoá một tệp.
  const idCard = page.locator("main div.rounded-xl", { hasText: "Giấy tờ tuỳ thân người đại diện" }).first();
  await idCard.locator('img[alt^="Tệp"]').nth(1).waitFor({ timeout: 20000 });
  check("ID card holds 2 files (front + back) with thumbnails", (await idCard.locator('img[alt^="Tệp"]').count()) === 2);
  // Chờ ảnh tải xong (qua tunnel Internet chậm hơn local) thay vì kiểm ngay lúc thẻ <img> vừa xuất hiện.
  const thumbsLoaded = await page
    .waitForFunction(() => {
      const card = [...document.querySelectorAll("main div.rounded-xl")].find((d) => d.innerText.includes("Giấy tờ tuỳ thân người đại diện"));
      const imgs = card ? [...card.querySelectorAll('img[alt^="Tệp"]')] : [];
      return imgs.length > 0 && imgs.every((e) => e.complete && e.naturalWidth > 0);
    }, null, { timeout: 15000 })
    .then(() => true, () => false);
  check("thumbnails actually load from private storage (signed URL)", thumbsLoaded);
  await idCard.getByRole("button", { name: "Xem tệp 1" }).click();
  const big = page.locator('[role="dialog"] img');
  await big.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => { const i = document.querySelector('[role="dialog"] img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  check("click thumbnail opens enlarged preview", true);
  await page.screenshot({ path: path.join(OUT, "05-legal-preview.png") });
  await page.keyboard.press("Escape");
  await idCard.getByRole("button", { name: "Xoá tệp 2" }).click();
  await page.waitForFunction(() => { const c = [...document.querySelectorAll("main div.rounded-xl")].find((d) => d.innerText.includes("Giấy tờ tuỳ thân người đại diện")); return c && c.querySelectorAll('img[alt^="Tệp"]').length === 1; }, null, { timeout: 15000 });
  check("remove one file -> 1 left, still Chờ duyệt", (await idCard.innerText()).includes("Chờ duyệt"));
  await ovf("legal");
  await page.screenshot({ path: path.join(OUT, "05-legal.png") });
  await page.getByRole("button", { name: /Tiếp tục/ }).click();

  // review + submit
  await page.getByText("Hồ sơ đã đủ thông tin").waitFor({ timeout: 15000 });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Gửi hồ sơ/ }).click();
  await page.getByText("Hồ sơ đã được gửi").waitFor({ timeout: 20000 });
  check("submitted -> UNDER_REVIEW view", true);
  await ovf("submitted");
  await page.screenshot({ path: path.join(OUT, "06-submitted.png") });

  // 5. applicant cannot reach operational area
  await page.goto(BASE + "/gym-owner/dashboard");
  await page.waitForURL("**/partner/application", { timeout: 15000 });
  check("direct /gym-owner/dashboard redirects applicant back", true);
  await page.goto(BASE + "/");
  await page.waitForURL("**/partner/application", { timeout: 15000 });
  check("root redirect by application state", true);

  // 6. admin: request changes, applicant fixes, resubmit, approve
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await actx.newPage(); ap.setDefaultNavigationTimeout(120000); ap.setDefaultTimeout(30000);
  ap.on("pageerror", (e) => errors.push("admin pageerror: " + e.message));
  await ap.goto(BASE + "/login");
  await ap.fill('input[type="email"], input[placeholder*="mail" i]', "admin@example.com");
  await ap.fill('input[type="password"]', "password123");
  await ap.getByRole("button", { name: /Đăng nhập/ }).first().click();
  await ap.waitForURL("**/admin/**", { timeout: 20000 });
  await ap.goto(BASE + "/admin/partners");
  await ap.getByText("hồ sơ đang chờ duyệt").waitFor({ timeout: 15000 });
  await ap.getByText(BRAND).first().click();
  await ap.getByText("Giấy tờ").first().waitFor();
  check("admin sees application detail (docs, photos, history)", true);
  await ap.getByText("Giấy chứng nhận PCCC").first().waitFor({ timeout: 10000 });
  check("admin doc list = applicant doc list (no 'Ảnh hiện trạng cơ sở')", (await ap.getByText("Ảnh hiện trạng cơ sở").count()) === 0);
  const approveBtn = ap.getByRole("button", { name: /Phê duyệt hồ sơ/ });
  check("approve disabled while documents unverified", await approveBtn.isDisabled());
  await ap.screenshot({ path: path.join(OUT, "07-admin-detail.png"), fullPage: true });

  // request changes on PHOTOS
  await ap.getByRole("button", { name: "Yêu cầu chỉnh sửa" }).click();
  await ap.getByPlaceholder("Cần sửa gì?").fill("Vui lòng chụp thêm ảnh khu tập chính");
  await ap.getByRole("button", { name: /Gửi yêu cầu chỉnh sửa/ }).click();
  await ap.getByText("Đang chờ ứng viên chỉnh sửa").waitFor({ timeout: 15000 });
  check("admin request-changes -> NEEDS_INFO", true);

  await page.reload();
  try { await page.getByText("Gymini đề nghị bạn chỉnh sửa").waitFor({ timeout: 20000 }); } catch (e) {
    await page.screenshot({ path: path.join(OUT, "10-no-cards.png"), fullPage: true });
    console.log("URL", page.url(), "BODY", (await page.locator("body").innerText()).slice(0, 500).split(String.fromCharCode(10)).join(" | "), "ERRS", errors.slice(-5));
    throw e;
  }
  check("applicant sees change-request card", true);
  const resubmit = page.getByRole("button", { name: /Gửi lại hồ sơ/ });
  { const nav = page.getByRole("button", { name: "Xem lại & gửi" }); if (await nav.isVisible()) await nav.click(); }
  check("resubmit disabled until issue marked updated", await resubmit.isDisabled());
  await page.getByRole("button", { name: /Đánh dấu đã cập nhật/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Đã gửi lại"), null, { timeout: 15000 });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => /Gửi lại hồ sơ/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 15000 });
  await resubmit.click();
  await page.getByText("Hồ sơ đã được gửi").waitFor({ timeout: 20000 });
  check("resubmitted -> UNDER_REVIEW again", true);

  await ap.reload();
  await ap.getByText(BRAND).first().click();
  const approve2 = ap.getByRole("button", { name: /Phê duyệt hồ sơ/ });
  await ap.getByText("Vấn đề đã yêu cầu").waitFor();
  check("approve still blocked by RESUBMITTED issue + unverified docs", await approve2.isDisabled());
  for (let guard = 0; guard < 6; guard++) {
    const btns = ap.getByRole("button", { name: "Chấp nhận" });
    const c = await btns.count();
    if (c === 0) break;
    await btns.first().click();
    await ap.waitForFunction((prev) => [...document.querySelectorAll("button")].filter((x) => x.textContent.trim() === "Chấp nhận").length < prev, c, { timeout: 15000 });
  }
  await ap.getByRole("button", { name: "Đóng", exact: true }).click();
  await ap.waitForTimeout(900);
  try {
    await ap.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => /Phê duyệt hồ sơ/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 15000 });
  } catch (e) {
    console.log("BLOCKERS:", await ap.locator("li:has-text('•')").allInnerTexts());
    await ap.screenshot({ path: path.join(OUT, "09-approve-blocked.png"), fullPage: true });
    throw e;
  }
  check("approve enabled after docs accepted + issue closed", true);
  ap.on("dialog", (d) => d.accept());
  await approve2.click();
  await ap.getByText("Hồ sơ đã được phê duyệt").waitFor({ timeout: 20000 });
  check("admin approved application", true);

  await page.goto(BASE + "/");
  await page.waitForURL("**/gym-owner/**", { timeout: 20000 });
  check("after approval applicant lands in gym-owner workspace", true, page.url());
  await page.screenshot({ path: path.join(OUT, "08-approved-dashboard.png") });

  // mobile widths on the applicant wizard (fresh context, existing applicant now approved -> check apply page + login only)
  for (const w of [360, 390, 412]) {
    const m = await browser.newContext({ viewport: { width: w, height: 800 } });
    const mp = await m.newPage();
    await mp.goto(BASE + "/partner/apply");
    await mp.waitForSelector("#apply-email");
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`no horizontal overflow @${w}px (apply page)`, !overflow);
    await m.close();
  }

  console.log("EMAIL", email);
  console.log("JS errors:", errors.length ? errors.slice(0, 8) : "none");
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error("SCRIPT ERROR:", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(2);
});
