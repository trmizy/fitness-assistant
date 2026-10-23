import test from "node:test";
import assert from "node:assert/strict";
import { partnerApplicationService } from "../services/partner-application.service";
import { partnerApplicationController } from "../controllers/partner-application.controller";

/**
 * Host của magic link đăng ký đối tác (POST /auth/partner-applications/start).
 *
 *   - request đi qua gateway (có x-gateway-secret đúng) và mang x-trusted-web-origin → link dùng origin đó
 *     (IP LAN / tunnel hiện tại), không phải FRONTEND_URL tĩnh;
 *   - không có header → FRONTEND_URL;
 *   - header do người gọi TỰ gửi thẳng vào auth-service (không có / sai x-gateway-secret) bị bỏ qua,
 *     kể cả khi giá trị trông "đẹp" — chống password-reset-poisoning kiểu link trỏ sang tên miền lạ.
 *
 * Evidence label: BACKEND INTEGRATION (controller thật + service bị thay bằng bản ghi lại tham số, không DB, không SMTP).
 * Việc gateway chỉ gắn header từ Origin đã qua allowlist được kiểm ở gateway/src/__tests__/gateway.partner-link-origin.test.ts.
 */

const SECRET = process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";
const TUNNEL = "https://quiet-river-1234.trycloudflare.com";

async function startWith(headers: Record<string, string>): Promise<string> {
  let usedBase = "";
  const original = partnerApplicationService.start;
  (partnerApplicationService as any).start = async (_email: string, base: string) => {
    usedBase = base;
    return { status: "SENT", email: "owner@gym.test", expiresInHours: 24 };
  };
  const savedFrontend = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "http://192.168.2.100:5173";
  try {
    let statusCode = 200;
    const res: any = {
      status(c: number) {
        statusCode = c;
        return this;
      },
      json() {
        return this;
      },
      setHeader() {},
    };
    await partnerApplicationController.start({ body: { email: "owner@gym.test" }, headers } as any, res);
    assert.equal(statusCode, 200);
    return usedBase;
  } finally {
    (partnerApplicationService as any).start = original;
    if (savedFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFrontend;
  }
}

test("qua gateway + x-trusted-web-origin → link dùng origin tin cậy (tunnel / LAN)", async () => {
  assert.equal(await startWith({ "x-gateway-secret": SECRET, "x-trusted-web-origin": TUNNEL }), TUNNEL);
  assert.equal(
    await startWith({ "x-gateway-secret": SECRET, "x-trusted-web-origin": "http://192.168.1.7:5173" }),
    "http://192.168.1.7:5173",
  );
});

test("qua gateway nhưng không có x-trusted-web-origin (app mobile, không Origin) → FRONTEND_URL", async () => {
  assert.equal(await startWith({ "x-gateway-secret": SECRET }), "http://192.168.2.100:5173");
});

test("gọi thẳng auth-service với x-trusted-web-origin tự đặt (không có secret) → bị bỏ qua, dùng FRONTEND_URL", async () => {
  assert.equal(await startWith({ "x-trusted-web-origin": "https://evil.example" }), "http://192.168.2.100:5173");
});

test("x-gateway-secret sai + x-trusted-web-origin giả → bị bỏ qua, dùng FRONTEND_URL", async () => {
  assert.equal(
    await startWith({ "x-gateway-secret": "not-the-secret", "x-trusted-web-origin": "https://evil.example" }),
    "http://192.168.2.100:5173",
  );
});

test("link thật được dựng từ base: /partner/apply/verify#token=… không bị lệch dấu / ở cuối", async () => {
  // dùng service thật (không thay) để chắc rằng base có dấu / cuối vẫn ra đúng đường dẫn — xem partner-application.test.ts
  // cho phần lưu băm token; ở đây chỉ kiểm hình dạng link qua devVerifyLink.
  const { partnerApplicationRepository: repo } = await import("../repositories/partner-application.repository");
  const { authRepository } = await import("../repositories/auth.repository");
  const saved = {
    find: authRepository.findUserByEmail,
    recent: repo.listRecentByEmail,
    create: repo.createToken,
    sup: repo.supersedeOthers,
  };
  (authRepository as any).findUserByEmail = async () => null;
  (repo as any).listRecentByEmail = async () => [];
  (repo as any).createToken = async () => ({ id: "tok-1" });
  (repo as any).supersedeOthers = async () => undefined;
  process.env.PARTNER_APPLICATION_DEV_ECHO = "true";
  try {
    const res = await partnerApplicationService.start("owner@gym.test", `${TUNNEL}/`);
    assert.ok(res.devVerifyLink!.startsWith(`${TUNNEL}/partner/apply/verify#token=`), res.devVerifyLink);
  } finally {
    delete process.env.PARTNER_APPLICATION_DEV_ECHO;
    (authRepository as any).findUserByEmail = saved.find;
    (repo as any).listRecentByEmail = saved.recent;
    (repo as any).createToken = saved.create;
    (repo as any).supersedeOthers = saved.sup;
  }
});
