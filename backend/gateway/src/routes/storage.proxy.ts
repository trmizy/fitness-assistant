import type { Request, RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

/**
 * Tệp riêng tư dev (hồ sơ đối tác: ảnh cơ sở, giấy tờ, logo; và ảnh tin đăng PT) — CHỈ bật ở dev, khi có MINIO_PROXY_TARGET.
 *
 * Vấn đề: link ký tạm (presigned) từng ký cho `http://localhost:9000`, nên chỉ mở được trên đúng máy chạy
 * Docker; điện thoại, máy khác trong mạng, app Android qua tunnel Cloudflare đều không tải/không xem được.
 * Cách sửa: gym-service ký link theo ĐÚNG địa chỉ người gọi đang dùng (x-public-base-url — xem
 * gym-service `request-context.ts`), đường dẫn `/<bucket>/<key>`; route này chuyển tiếp đường dẫn đó
 * sang MinIO. Chỉ cần MỘT tunnel như hiện nay.
 *
 * Chữ ký SigV4 của MinIO có tính cả header Host, nên phải gửi sang MinIO đúng Host đã dùng lúc ký —
 * cùng một cách tính với x-public-base-url trong app.ts (X-Forwarded-Host của Vite, nếu không thì Host).
 * Người gọi tự đặt X-Forwarded-Host khác thì chỉ làm hỏng chữ ký link của chính họ, không đọc được thêm
 * gì: bucket không có quyền ẩn danh, mọi đọc/ghi vẫn phải có chữ ký hợp lệ.
 *
 * Trên AWS thật không bật (không có MINIO_PROXY_TARGET): trình duyệt gọi thẳng S3.
 */
function publicHost(req: Request): string | undefined {
  const forwardedHost = req.headers["x-forwarded-host"];
  return (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(",")[0]?.trim() || req.get("host") || undefined;
}

/**
 * Một proxy cho mỗi bucket riêng tư cần đi qua cổng gateway ở dev:
 *   - PARTNER_S3_PRIVATE_BUCKET: giấy tờ/ảnh cơ sở/logo của đối tác gym (gym-service ký theo địa chỉ người gọi);
 *   - PT_MEDIA_S3_BUCKET: ảnh tin đăng PT (ảnh thể hình…) — user-service PHẢI ký theo địa chỉ người gọi
 *     thì link mới mở được qua tunnel/IP LAN (xem ghi chú bàn giao trong báo cáo B05).
 * Cùng MinIO (MINIO_PROXY_TARGET), cùng cách chuyển tiếp; trùng tên bucket thì chỉ mount một lần.
 */
function buildFor(bucket: string, target: string): { path: string; handler: RequestHandler } {
  return {
    path: `/${bucket}`,
    handler: createProxyMiddleware({
      target,
      changeOrigin: false,
      // http-proxy-middleware 2.x tự khôi phục req.originalUrl (đường dẫn đầy đủ `/<bucket>/<key>?…`),
      // đúng thứ đã được ký — không cần pathRewrite.
      onProxyReq: (proxyReq, req) => {
        const host = publicHost(req as Request);
        if (host) {
          proxyReq.setHeader("host", host);
          proxyReq.setHeader("x-forwarded-host", host);
        }
        // Không để lộ header nội bộ của gateway sang MinIO.
        proxyReq.removeHeader("x-gateway-secret");
        proxyReq.removeHeader("authorization");
      },
      onError: (_err, _req, res) => {
        (res as any).status?.(502).json?.({ success: false, error: { message: "Kho tệp tạm thời không phản hồi" } });
      },
    }),
  };
}

function build(): { path: string; handler: RequestHandler }[] {
  const target = process.env.MINIO_PROXY_TARGET;
  const buckets = Array.from(
    new Set([process.env.PARTNER_S3_PRIVATE_BUCKET, process.env.PT_MEDIA_S3_BUCKET].filter((b): b is string => Boolean(b))),
  );
  if (!target || buckets.length === 0) return [];
  if (process.env.NODE_ENV === "production") {
    // Không bao giờ phơi MinIO ở production — production dùng S3 thật.
    throw new Error("MINIO_PROXY_TARGET must not be set in production");
  }
  return buckets.map((bucket) => buildFor(bucket, target));
}

export const storageProxies = build();
