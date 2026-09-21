import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { _resetPublicWebOriginCache, publicWebOrigin } from "../utils/publicWebOrigin";
import { emailLinkOrigin, isAllowedOrigin, trustedWebOrigin } from "../utils/corsOrigins";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-origin-"));
const file = path.join(dir, "public-web-origin");
const TUNNEL = "https://quiet-river-1234.trycloudflare.com";

function writeOrigin(value: string, ageMs = 0) {
  fs.writeFileSync(file, value);
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
  _resetPublicWebOriginCache();
}

test.beforeEach(() => {
  process.env.PUBLIC_WEB_ORIGIN_FILE = file;
  fs.rmSync(file, { force: true });
  _resetPublicWebOriginCache();
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("không có tệp (chưa mở tunnel web) → không có địa chỉ công khai", () => {
  assert.equal(publicWebOrigin(), null);
});

test("tệp mới (tunnel đang chạy) → dùng làm host cho link email, ưu tiên hơn Origin của trình duyệt", () => {
  writeOrigin(`${TUNNEL}\n`);
  assert.equal(publicWebOrigin(), TUNNEL);
  assert.equal(emailLinkOrigin("http://localhost:5173"), TUNNEL);
  assert.equal(emailLinkOrigin(undefined), TUNNEL, "cả request không có Origin (app) cũng nhận link công khai");
});

test("tệp cũ hơn 2 phút (tunnel đã tắt) → bỏ qua, quay về Origin tin cậy / FRONTEND_URL", () => {
  writeOrigin(TUNNEL, 3 * 60 * 1000);
  assert.equal(publicWebOrigin(), null);
  assert.equal(emailLinkOrigin("http://localhost:5173"), "http://localhost:5173");
});

test("nội dung tệp không phải https origin hợp lệ → bỏ qua", () => {
  for (const bad of ["http://quiet-river.trycloudflare.com", "https://evil.example/path", "javascript:alert(1)", ""]) {
    writeOrigin(bad);
    assert.equal(publicWebOrigin(), null, bad);
  }
});

test("CORS tin ĐÚNG địa chỉ tunnel trong tệp, KHÔNG mở cả *.trycloudflare.com", () => {
  writeOrigin(TUNNEL);
  assert.equal(isAllowedOrigin(TUNNEL), true);
  assert.equal(isAllowedOrigin("https://attacker-5678.trycloudflare.com"), false);
});

test("link email không bao giờ lấy host từ một *.trycloudflare.com lạ do người gọi tự đặt làm Origin", () => {
  writeOrigin(TUNNEL, 3 * 60 * 1000); // tunnel đã tắt
  assert.equal(emailLinkOrigin("https://attacker-5678.trycloudflare.com"), null);
});

test("Origin của app Android (Capacitor WebView: localhost KHÔNG cổng) không được dùng làm host link email", () => {
  for (const o of ["http://localhost", "https://localhost", "capacitor://localhost", "http://localhost/"]) {
    assert.equal(trustedWebOrigin(o), null, o);
  }
  assert.equal(trustedWebOrigin("http://localhost:5173"), "http://localhost:5173", "web dev thật (có cổng) vẫn dùng được");
  assert.equal(isAllowedOrigin("http://localhost"), true, "CORS cho app Android vẫn giữ nguyên");
});
