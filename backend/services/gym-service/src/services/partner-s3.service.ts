import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertPartnerS3ProductionSafe } from './partner-s3.guard';

/**
 * S3 cho hồ sơ đối tác tự đăng ký — GYM_PARTNER_SECURITY_MODEL.md §6.
 *
 * MỘT bucket, mọi tệp riêng tư: giấy tờ pháp lý, ảnh cơ sở và logo thương hiệu đều nằm dưới
 * `partner-applications/`, không có quyền công khai nào, và chỉ đọc được qua presigned GET ngắn hạn.
 * Không có bản sao công khai nào cả — hiện không bề mặt ẩn danh nào của sản phẩm hiển thị ảnh phòng
 * gym (route công khai `/gyms`, `/gyms/:id` không trả ảnh), nên một bucket công khai + CDN sẽ là hạ
 * tầng không ai dùng. Khi nào có trang tìm phòng gym cho khách thì mới dựng, và lúc đó thêm một
 * nhánh phục vụ qua CDN chứ không phải sửa lại chỗ này.
 *
 * Cấu hình dùng PARTNER_S3_* (không dùng AWS_*): .env có thể mang khoá AWS thật cho service khác và
 * không được lọt nhầm vào bucket dev. Presigned URL ký cho host mà TRÌNH DUYỆT sẽ gọi
 * (PARTNER_S3_PUBLIC_ENDPOINT), còn thao tác phía server (HEAD, đọc đầu tệp, sao chép, xoá) dùng
 * endpoint nội bộ. Trên AWS thật cả hai endpoint để trống.
 *
 * Không gửi header mã hoá phía server: mã hoá dùng default-encryption của bucket (chuẩn dự án —
 * infra/terraform/modules/private-s3-bucket); MinIO từ chối header SSE nếu chưa cấu hình KMS.
 */

interface S3Config {
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  privateBucket: string;
}

function readConfig(): S3Config {
  assertPartnerS3ProductionSafe();
  const accessKeyId = process.env.PARTNER_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.PARTNER_S3_SECRET_ACCESS_KEY;
  const endpoint = process.env.PARTNER_S3_ENDPOINT || undefined;
  return {
    endpoint,
    publicEndpoint: process.env.PARTNER_S3_PUBLIC_ENDPOINT || endpoint,
    region: process.env.PARTNER_S3_REGION || process.env.AWS_REGION || 'us-east-1',
    forcePathStyle: process.env.PARTNER_S3_FORCE_PATH_STYLE === 'true',
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    privateBucket: process.env.PARTNER_S3_PRIVATE_BUCKET || '',
  };
}

function makeClient(cfg: S3Config, endpoint: string | undefined): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: cfg.credentials,
  });
}

let cached: { key: string; internal: S3Client; signing: S3Client } | null = null;
function clients(cfg: S3Config) {
  const key = JSON.stringify([cfg.endpoint, cfg.publicEndpoint, cfg.region, cfg.forcePathStyle, cfg.credentials?.accessKeyId]);
  if (!cached || cached.key !== key) {
    cached = {
      key,
      internal: makeClient(cfg, cfg.endpoint),
      signing: makeClient(cfg, cfg.publicEndpoint),
    };
  }
  return cached;
}

function unavailable(): Error {
  return Object.assign(new Error('Tính năng tải tệp chưa được cấu hình trên môi trường này'), {
    status: 503,
    code: 'UPLOADS_UNAVAILABLE',
  });
}

export const partnerS3 = {
  isConfigured(): boolean {
    return Boolean(readConfig().privateBucket);
  },

  /** Presigned POST: điều kiện kích thước + Content-Type được KÝ vào policy, S3/MinIO tự từ chối tệp sai. */
  async presignUpload(params: { key: string; contentType: string; maxBytes: number; expiresSec?: number }) {
    const cfg = readConfig();
    if (!cfg.privateBucket) throw unavailable();
    const { url, fields } = await createPresignedPost(clients(cfg).signing, {
      Bucket: cfg.privateBucket,
      Key: params.key,
      Expires: params.expiresSec ?? 300,
      Fields: { 'Content-Type': params.contentType },
      Conditions: [
        ['content-length-range', 1, params.maxBytes],
        ['eq', '$Content-Type', params.contentType],
      ],
    });
    return { url, fields };
  },

  /** Đọc lại tệp riêng tư: hạn ngắn, ép loại nội dung đã xác thực; giấy tờ ép tải xuống thay vì mở. */
  async presignGet(params: { key: string; contentType?: string; attachment?: boolean; expiresSec?: number }) {
    const cfg = readConfig();
    if (!cfg.privateBucket) throw unavailable();
    return getSignedUrl(
      clients(cfg).signing,
      new GetObjectCommand({
        Bucket: cfg.privateBucket,
        Key: params.key,
        ResponseContentType: params.contentType,
        ResponseContentDisposition: params.attachment ? 'attachment' : 'inline',
      }),
      { expiresIn: params.expiresSec ?? 120 },
    );
  },

  async headObject(key: string): Promise<{ contentLength?: number; contentType?: string; serverSideEncryption?: string } | null> {
    const cfg = readConfig();
    if (!cfg.privateBucket) throw unavailable();
    try {
      const out = await clients(cfg).internal.send(new HeadObjectCommand({ Bucket: cfg.privateBucket, Key: key }));
      return {
        contentLength: out.ContentLength,
        contentType: out.ContentType,
        serverSideEncryption: out.ServerSideEncryption,
      };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
      throw e;
    }
  },

  /** 16 byte đầu tệp — đủ để nhận chữ ký PDF/PNG/JPEG/WEBP. */
  async readHead(key: string, bytes = 16): Promise<Uint8Array> {
    const cfg = readConfig();
    if (!cfg.privateBucket) throw unavailable();
    const out = await clients(cfg).internal.send(
      new GetObjectCommand({ Bucket: cfg.privateBucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return (await out.Body!.transformToByteArray()) as Uint8Array;
  },

  async deleteObject(key: string): Promise<void> {
    const cfg = readConfig();
    if (!cfg.privateBucket) throw unavailable();
    await clients(cfg).internal.send(new DeleteObjectCommand({ Bucket: cfg.privateBucket, Key: key }));
  },

};
