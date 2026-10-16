/**
 * Phase 7 — CL-09 vá 21/9 theo web: chi tiết phòng gym đầy đủ, đọc từ backend THẬT qua gateway, bằng
 * đúng các hàm màn hình dùng (`normalizeGym`, `aboutText`, `fullAddress`, `directionsUrl`, `socialLinks`).
 *
 *   pnpm test:e2e            (gateway http://localhost:3000, john.doe@example.com)
 *
 * Không tạo/sửa dữ liệu nào. Cần ít nhất một phòng gym đã duyệt có ảnh (vd "Gymini Phú Nhuận").
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { ABOUT_MAX, aboutText, directionsUrl, fullAddress, normalizeGym, normalizeGyms, socialLinks } from "../src/features/services/gymDirectory";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "john.doe@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
let token = "";

async function get(path: string, extra: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}`, ...extra } });
  const body: any = await res.json();
  return { status: res.status, data: body?.data ?? body };
}

before(async () => {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body: any = await res.json();
  token = body?.data?.accessToken ?? body?.accessToken;
  assert.ok(token, "login failed");
});

describe("CL-09 gym detail against the real backend", () => {
  it("a gym with photos: signed photo URLs load, about ≤300, full address from ward/province names, branches for the map", async () => {
    const list = normalizeGyms((await get("/gyms")).data);
    let detail: ReturnType<typeof normalizeGym> | null = null;
    for (const g of list) {
      const d = normalizeGym((await get(`/gyms/${g.id}`)).data);
      if (d.photos.length > 0) {
        detail = d;
        break;
      }
    }
    assert.ok(detail, "no approved gym with photos in this database");

    // Ảnh: link ký tạm tải được qua gateway (chữ ký đúng host app đang gọi).
    const photo = await fetch(detail.photos[0].url);
    assert.equal(photo.status, 200);
    assert.match(photo.headers.get("content-type") ?? "", /^image\//);

    const about = aboutText(detail);
    if (about) assert.ok(about.length <= ABOUT_MAX + 1, `about is ${about.length} chars`);

    if (detail.provinceCode != null) {
      const provinces = (await get("/locations/provinces")).data as { code: number; name: string }[];
      const wards = (await get(`/locations/provinces/${detail.provinceCode}/wards`)).data as { code: number; name: string }[];
      const address = fullAddress(detail, {
        province: provinces.find((p) => p.code === detail!.provinceCode)?.name,
        ward: wards.find((w) => w.code === detail!.wardCode)?.name,
      });
      assert.match(address, /(Phường|Xã|Đặc khu)/, address);
    }

    assert.ok(detail.brandBranches.some((b) => b.id === detail!.id), "the branch itself is in its brand's branch list");
    if (detail.latitude != null) assert.match(directionsUrl(detail)!, /^https:\/\/www\.google\.com\/maps\/dir\//);
    for (const s of socialLinks(detail)) assert.ok(s.url.startsWith("https://"));
  });

  it("signed photo URLs follow the address the app called (E2E_BASE_URL), never the fixed localhost:9000", async () => {
    // fetch của Node không cho đặt header Host, nên kiểm bằng chính địa chỉ gốc test gọi tới — chạy lại với
    // E2E_BASE_URL=http://10.0.2.2:3000 (emulator), IP LAN hay tunnel thì link cũng phải theo địa chỉ đó.
    const origin = new URL(BASE_URL).origin;
    const list = normalizeGyms((await get("/gyms")).data);
    for (const g of list) {
      const d = normalizeGym((await get(`/gyms/${g.id}`)).data);
      if (d.photos.length === 0) continue;
      assert.ok(d.photos[0].url.startsWith(`${origin}/`), d.photos[0].url);
      assert.ok(!d.photos[0].url.includes(":9000/"), "not signed for MinIO's own port");
      return;
    }
    assert.fail("no gym with photos");
  });

});
