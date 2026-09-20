import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnerS3ProductionViolations, assertPartnerS3ProductionSafe } from '../services/partner-s3.guard';

const prod = { NODE_ENV: 'production' };

test('ngoài production: cấu hình MinIO dev luôn hợp lệ', () => {
  const env = { NODE_ENV: 'development', PARTNER_S3_ENDPOINT: 'http://minio:9000', PARTNER_S3_FORCE_PATH_STYLE: 'true', PARTNER_S3_ACCESS_KEY_ID: 'k', PARTNER_S3_SECRET_ACCESS_KEY: 's' };
  assert.deepEqual(partnerS3ProductionViolations(env), []);
});

test('production sạch (chỉ tên bucket, CDN https) hợp lệ', () => {
  const env = { ...prod, PARTNER_S3_PRIVATE_BUCKET: 'a' };
  assert.deepEqual(partnerS3ProductionViolations(env), []);
  assert.doesNotThrow(() => assertPartnerS3ProductionSafe(env));
});

for (const [name, extra] of Object.entries({
  endpoint: { PARTNER_S3_ENDPOINT: 'http://minio:9000' },
  publicEndpoint: { PARTNER_S3_PUBLIC_ENDPOINT: 'http://localhost:9000' },
  pathStyle: { PARTNER_S3_FORCE_PATH_STYLE: 'true' },
  staticKey: { PARTNER_S3_ACCESS_KEY_ID: 'gymini_minio' },
  staticSecret: { PARTNER_S3_SECRET_ACCESS_KEY: 'x' },
  // Bucket công khai đã bị gỡ: còn sót biến nào của nó cũng là cấu hình cũ, phải chặn.
  publicBucketLeftover: { PARTNER_S3_PUBLIC_BUCKET: 'b' },
  publicBaseUrlLeftover: { PARTNER_S3_PUBLIC_BASE_URL: 'https://cdn.example.com/p' },
})) {
  test(`production từ chối: ${name}`, () => {
    const env = { ...prod, ...extra };
    assert.ok(partnerS3ProductionViolations(env).length >= 1);
    assert.throws(() => assertPartnerS3ProductionSafe(env), /không an toàn cho production/);
  });
}

test('production: FORCE_PATH_STYLE=false vẫn hợp lệ', () => {
  assert.deepEqual(partnerS3ProductionViolations({ ...prod, PARTNER_S3_FORCE_PATH_STYLE: 'false' }), []);
});
