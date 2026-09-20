/**
 * Dọn tệp mồ côi: tệp đã nằm trên S3 nhưng người dùng không bao giờ bấm xác nhận.
 * BACKEND INTEGRATION — cần DATABASE_URL (DB `*_test`) và MinIO thật.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:9';
process.env.PARTNER_S3_ENDPOINT = process.env.PARTNER_S3_ENDPOINT || 'http://localhost:9000';
process.env.PARTNER_S3_PUBLIC_ENDPOINT = process.env.PARTNER_S3_PUBLIC_ENDPOINT || 'http://localhost:9000';
process.env.PARTNER_S3_REGION = 'us-east-1';
process.env.PARTNER_S3_FORCE_PATH_STYLE = 'true';
process.env.PARTNER_S3_ACCESS_KEY_ID = process.env.PARTNER_S3_ACCESS_KEY_ID || 'gymini_minio';
process.env.PARTNER_S3_SECRET_ACCESS_KEY = process.env.PARTNER_S3_SECRET_ACCESS_KEY || 'gymini_minio_secret';
process.env.PARTNER_S3_PRIVATE_BUCKET = process.env.PARTNER_S3_PRIVATE_BUCKET || 'gymini-partner-private';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

integrationTest('sweep xoá tệp của lượt tải lên bỏ dở, giữ nguyên lượt đã xác nhận và lượt còn hạn', async (t) => {
  const { prisma } = await import('../repositories/prisma');
  const { partnerS3 } = await import('../services/partner-s3.service');
  const { runPartnerUploadSweep } = await import('../services/partner-upload-sweep.service');
  const { partnerApplicationService } = await import('../services/partner-application.service');

  try {
    if ((await partnerS3.headObject('__probe__')) !== null) return t.skip('MinIO không chạy');
  } catch {
    return t.skip('MinIO không chạy');
  }

  const ownerId = randomUUID();
  const { partnerId } = await partnerApplicationService.bootstrap(ownerId, `${ownerId.slice(0, 8)}@sweep.test`);

  const put = async (suffix: string) => {
    const key = `partner-applications/${partnerId}/photos/${randomUUID()}-${suffix}.png`;
    const { url, fields } = await partnerS3.presignUpload({ key, contentType: 'image/png', maxBytes: 1024 * 1024 });
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v as string);
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'f.png');
    const res = await fetch(url, { method: 'POST', body: form });
    assert.ok([200, 201, 204].includes(res.status), `S3 POST → ${res.status}`);
    return key;
  };

  const mkIntent = (key: string, expiresAt: Date, confirmedAt: Date | null) =>
    prisma.partnerUploadIntent.create({
      data: {
        partnerId,
        kind: 'PHOTO',
        photoCategory: 'OTHER',
        objectKey: key,
        contentType: 'image/png',
        maxBytes: 1024 * 1024,
        createdBy: ownerId,
        expiresAt,
        confirmedAt,
      },
    });

  const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const soon = new Date(Date.now() + 10 * 60 * 1000);

  const orphanKey = await put('orphan');
  const confirmedKey = await put('confirmed');
  const freshKey = await put('fresh');
  const orphan = await mkIntent(orphanKey, longAgo, null);
  const confirmed = await mkIntent(confirmedKey, longAgo, new Date());
  const fresh = await mkIntent(freshKey, soon, null);

  try {
    const out = await runPartnerUploadSweep();
    assert.equal(out.skipped, false);
    assert.ok(out.deleted >= 1, `phải xoá ít nhất tệp mồ côi, deleted=${out.deleted}`);

    assert.equal(await partnerS3.headObject(orphanKey), null, 'tệp mồ côi phải bị xoá khỏi S3');
    assert.equal(await prisma.partnerUploadIntent.findUnique({ where: { id: orphan.id } }), null, 'dòng intent mồ côi phải bị xoá');

    assert.notEqual(await partnerS3.headObject(confirmedKey), null, 'tệp ĐÃ xác nhận không được đụng vào');
    assert.notEqual(await prisma.partnerUploadIntent.findUnique({ where: { id: confirmed.id } }), null);
    assert.notEqual(await partnerS3.headObject(freshKey), null, 'lượt còn hạn không được đụng vào');
    assert.notEqual(await prisma.partnerUploadIntent.findUnique({ where: { id: fresh.id } }), null);
  } finally {
    for (const k of [orphanKey, confirmedKey, freshKey]) await partnerS3.deleteObject(k).catch(() => undefined);
    await prisma.partnerUploadIntent.deleteMany({ where: { partnerId } });
    await prisma.gymPartner.deleteMany({ where: { id: partnerId } });
    await prisma.$disconnect();
  }
});
