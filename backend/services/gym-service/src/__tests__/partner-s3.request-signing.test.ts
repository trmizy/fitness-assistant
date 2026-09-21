import test from 'node:test';
import assert from 'node:assert/strict';

// Cấu hình giống dev compose (không cần MinIO thật: ký link chỉ là tính toán).
process.env.PARTNER_S3_ENDPOINT = 'http://minio:9000';
process.env.PARTNER_S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
process.env.PARTNER_S3_REGION = 'us-east-1';
process.env.PARTNER_S3_FORCE_PATH_STYLE = 'true';
process.env.PARTNER_S3_ACCESS_KEY_ID = 'k';
process.env.PARTNER_S3_SECRET_ACCESS_KEY = 's';
process.env.PARTNER_S3_PRIVATE_BUCKET = 'gymini-partner-private';

const SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

async function signWithin(headers: Record<string, string>) {
  const { requestContextMiddleware } = await import('../middleware/request-context.middleware');
  const { partnerS3 } = await import('../services/partner-s3.service');
  return new Promise<{ get: string; post: string }>((resolve, reject) => {
    requestContextMiddleware({ headers } as any, {} as any, () => {
      Promise.all([
        partnerS3.presignGet({ key: 'partner-applications/p/photos/a.jpg', expiresSec: 60 }),
        partnerS3.presignUpload({ key: 'partner-applications/p/photos/b.jpg', contentType: 'image/jpeg', maxBytes: 1000 }),
      ])
        .then(([get, post]) => resolve({ get, post: post.url }))
        .catch(reject);
    });
  });
}

test('bật PARTNER_S3_PUBLIC_VIA_REQUEST: link ký theo ĐÚNG địa chỉ người gọi đang dùng (tunnel), đường dẫn /<bucket>/…', async () => {
  process.env.PARTNER_S3_PUBLIC_VIA_REQUEST = 'true';
  const r = await signWithin({ 'x-gateway-secret': SECRET, 'x-public-base-url': 'https://quiet-river-1234.trycloudflare.com' });
  assert.ok(r.get.startsWith('https://quiet-river-1234.trycloudflare.com/gymini-partner-private/partner-applications/'), r.get);
  assert.equal(r.post, 'https://quiet-river-1234.trycloudflare.com/gymini-partner-private');
});

test('header không đi qua gateway (sai/thiếu secret) → bỏ qua, dùng PARTNER_S3_PUBLIC_ENDPOINT', async () => {
  process.env.PARTNER_S3_PUBLIC_VIA_REQUEST = 'true';
  const r = await signWithin({ 'x-public-base-url': 'https://evil.example' });
  assert.ok(r.get.startsWith('http://localhost:9000/gymini-partner-private/'), r.get);
});

test('giá trị x-public-base-url không phải origin hợp lệ → bỏ qua', async () => {
  process.env.PARTNER_S3_PUBLIC_VIA_REQUEST = 'true';
  const r = await signWithin({ 'x-gateway-secret': SECRET, 'x-public-base-url': 'https://a.example/path?x=1' });
  assert.ok(r.get.startsWith('http://localhost:9000/'), r.get);
});

test('tắt cờ (mặc định) → luôn ký cho PARTNER_S3_PUBLIC_ENDPOINT như trước', async () => {
  delete process.env.PARTNER_S3_PUBLIC_VIA_REQUEST;
  const r = await signWithin({ 'x-gateway-secret': SECRET, 'x-public-base-url': 'http://192.168.1.5:5173' });
  assert.ok(r.get.startsWith('http://localhost:9000/'), r.get);
});

test('guard production: cờ ký-theo-request bị cấm ở production', async () => {
  const { partnerS3ProductionViolations } = await import('../services/partner-s3.guard');
  const v = partnerS3ProductionViolations({ NODE_ENV: 'production', PARTNER_S3_PUBLIC_VIA_REQUEST: 'true' });
  assert.ok(v.some((x) => x.includes('PARTNER_S3_PUBLIC_VIA_REQUEST')));
});
