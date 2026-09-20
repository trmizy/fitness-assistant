import rateLimit, { type RateLimitRequestHandler, type Store } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { createClient } from "redis";
import { logger } from "@gym-coach/shared";

/**
 * Giới hạn tần suất THEO IP cho luồng đối tác Gym tự đăng ký (GYM_PARTNER_SECURITY_MODEL.md §5).
 *
 * `start` gửi email tới một địa chỉ do người lạ tự nhập, nên phải có trần theo IP. Trần theo EMAIL
 * (cooldown + số email/ngày) nằm ở auth-service và đọc từ DB. Hai tầng bổ trợ nhau: IP chặn một
 * nguồn quét nhiều địa chỉ, email chặn nhiều nguồn dội vào một hộp thư.
 *
 * Store: Redis khi có REDIS_URL — bắt buộc ở production vì store mặc định của express-rate-limit
 * nằm trong bộ nhớ MỘT tiến trình, nên chạy nhiều instance thì mỗi instance đếm riêng và trần thực
 * tế nhân lên. Không có Redis thì rơi về bộ nhớ, CHỈ chấp nhận cho local/MVP; đặt
 * RATE_LIMIT_REQUIRE_SHARED=true ở production để gateway từ chối khởi động thay vì lặng lẽ chạy
 * với store không chia sẻ được.
 */

const WINDOW_MS = Number(process.env.PARTNER_APPLICATION_RATE_WINDOW_MS || 15 * 60 * 1000);
const START_MAX = Number(process.env.PARTNER_APPLICATION_START_RATE_MAX || 10);
const ANY_MAX = Number(process.env.PARTNER_APPLICATION_RATE_MAX || 60);

let client: ReturnType<typeof createClient> | null = null;
let connecting: Promise<void> | null = null;

function redisUrl(): string {
  return process.env.REDIS_URL?.trim() || "";
}

function sharedClient() {
  if (!client) {
    client = createClient({
      url: redisUrl(),
      socket: { reconnectStrategy: (attempt) => Math.min(attempt * 200, 5000) },
    });
    client.on("error", (err) => logger.error({ err }, "Rate-limit Redis error"));
    connecting = client.connect().then(() => undefined);
    // Lỗi kết nối được xử lý ở initPartnerApplicationRateLimit; không để thành unhandled rejection.
    connecting.catch(() => undefined);
  }
  return client;
}

function storeFor(prefix: string): Store | undefined {
  if (!redisUrl()) return undefined;
  const c = sharedClient();
  return new RedisStore({
    prefix,
    sendCommand: async (...args: string[]) => {
      await connecting;
      return (await c.sendCommand(args)) as never;
    },
  });
}

export function createPartnerApplicationLimiter(options: {
  max: number;
  prefix: string;
  windowMs?: number;
  store?: Store;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs ?? WINDOW_MS,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    // Redis chập chờn không được làm sập đăng nhập/đăng ký; trần theo email ở DB vẫn còn hiệu lực.
    passOnStoreError: true,
    store: options.store ?? storeFor(options.prefix),
    message: {
      error: "Bạn đã thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.",
      code: "IP_RATE_LIMITED",
    },
  });
}

/** POST /auth/partner-applications/start — gửi email, nên trần chặt nhất. */
export const partnerApplicationStartLimiter = createPartnerApplicationLimiter({
  max: START_MAX,
  prefix: "rl:partner-apply:start:",
});

/** Mọi endpoint còn lại của luồng (verify, set-password). */
export const partnerApplicationLimiter = createPartnerApplicationLimiter({
  max: ANY_MAX,
  prefix: "rl:partner-apply:any:",
});

/**
 * Gọi lúc khởi động. Có Redis → kiểm tra kết nối được; không có → cảnh báo lớn (hoặc từ chối
 * khởi động nếu RATE_LIMIT_REQUIRE_SHARED=true).
 */
export async function initPartnerApplicationRateLimit(): Promise<void> {
  const required = process.env.RATE_LIMIT_REQUIRE_SHARED === "true";

  if (!redisUrl()) {
    if (required) {
      throw new Error(
        "RATE_LIMIT_REQUIRE_SHARED=true nhưng chưa đặt REDIS_URL — giới hạn tần suất theo IP của luồng đối tác cần store chia sẻ.",
      );
    }
    logger.warn(
      "Partner-application IP rate limit is using a per-process in-memory store. Acceptable for local/MVP only — NOT safe when running more than one gateway instance; a shared store (REDIS_URL) is a go-live requirement.",
    );
    return;
  }

  sharedClient();
  try {
    await Promise.race([
      connecting,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connect timeout")), 5000)),
    ]);
    logger.info("Partner-application IP rate limit is backed by shared Redis store");
  } catch (err) {
    if (required) throw err;
    logger.warn(
      { err },
      "Partner-application IP rate limit could not reach Redis; requests will pass the store error (per-email limits in auth-service still apply). Go-live blocker if this is production.",
    );
  }
}
