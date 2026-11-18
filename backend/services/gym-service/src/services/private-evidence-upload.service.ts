import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { logger } from '@gym-coach/shared';
import { partnerS3 } from './partner-s3.service';
import {
  MAX_UPLOAD_BYTES,
  extensionFor,
  isAllowedContentType,
  validateStoredObject,
  type UploadKind,
} from './partner-upload.rules';

/**
 * Tệp bằng chứng RIÊNG TƯ do người dùng tải lên: ảnh khiếu nại của hội viên và giấy tờ chi nhánh của chủ gym.
 *
 * Trước đây hai luồng này dùng multer ghi ra đĩa cục bộ → trên AWS Lambda (đĩa chỉ đọc) bị tắt hẳn (503). Nay dùng cùng
 * luồng với hồ sơ đối tác (partner-upload.service.ts): `presign` → trình duyệt/app POST THẲNG lên S3 → `confirm`. Dùng lại
 * partnerS3 (cùng bucket riêng tư, không quyền công khai) và partner-upload.rules (loại tệp, kích thước, đọc chữ ký đầu tệp).
 * Server HEAD + đọc 16 byte đầu để chắc tệp thật sự đúng loại/cỡ đã khai; sai thì XOÁ tệp.
 *
 * Khác partner-upload ở MỘT điểm có chủ ý: "intent" ở đây là chuỗi KÝ HMAC không trạng thái, không phải một dòng
 * partner_upload_intents. Lý do: bảng đó bắt buộc có partnerId (FK tới hồ sơ đối tác) mà người khiếu nại là hội viên, không có
 * hồ sơ đối tác; thêm bảng mới nghĩa là đổi schema DB DEV trong lúc đối tác đang kiểm thử. Chuỗi ký gắn chặt người tải, loại tệp,
 * kích thước tối đa, phạm vi (gym/loại giấy tờ) và hạn dùng — client không thể đổi hay tái dùng cho người/phạm vi khác.
 *
 * Tên tệp (`token`) giữ đúng dạng cũ `<userId>-<thời điểm>-<ngẫu nhiên>.<đuôi>` để cột DB (photoTokens / fileToken) và luật
 * "chỉ người gửi hoặc ADMIN (khi tệp đã đính kèm) được xem" không đổi. Khoá S3 = `<tiền tố>/<token>`.
 */

export type EvidenceKind = 'COMPLAINT_PHOTO' | 'BRANCH_DOCUMENT';

interface KindConfig {
  prefix: string;
  uploadKind: UploadKind;
  maxBytes: number;
  rejectMessage: string;
}

const KINDS: Record<EvidenceKind, KindConfig> = {
  // Ảnh khiếu nại: JPEG/PNG/WebP, tối đa 8 MB (mức cũ của multer).
  COMPLAINT_PHOTO: {
    prefix: 'complaint-photos',
    uploadKind: 'PHOTO',
    maxBytes: Math.min(8 * 1024 * 1024, MAX_UPLOAD_BYTES),
    rejectMessage: 'Ảnh chỉ nhận JPEG, PNG hoặc WebP',
  },
  // Giấy tờ chi nhánh: PDF/JPEG/PNG, tối đa 10 MB (mức cũ của multer).
  BRANCH_DOCUMENT: {
    prefix: 'branch-documents',
    uploadKind: 'DOCUMENT',
    maxBytes: Math.min(10 * 1024 * 1024, MAX_UPLOAD_BYTES),
    rejectMessage: 'Giấy tờ chỉ nhận PDF, JPEG hoặc PNG',
  },
};

const INTENT_TTL_MS = 10 * 60 * 1000;

export class EvidenceUploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EvidenceUploadError';
  }
}

function secret(): string {
  const s = process.env.INTERNAL_SERVICE_SECRET || process.env.INTERNAL_API_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new EvidenceUploadError(503, 'UPLOADS_UNAVAILABLE', 'Tính năng tải tệp chưa được cấu hình trên môi trường này');
  }
  return 'dev_internal_service_secret_change_in_production';
}

const b64u = (b: Buffer) => b.toString('base64url');

function sign(body: string): string {
  // Tách miền khoá: chuỗi này không dùng được thay cho chữ ký của chỗ khác dùng cùng secret.
  return b64u(createHmac('sha256', secret()).update(`evidence-upload-intent:v1:${body}`).digest());
}

interface IntentPayload {
  /** loại bằng chứng */
  k: EvidenceKind;
  /** người tải (userId) */
  u: string;
  /** tên tệp (token) — khoá S3 là `<prefix>/<token>` */
  t: string;
  /** Content-Type đã khai (và đã ký vào policy S3) */
  c: string;
  /** trần kích thước */
  m: number;
  /** hạn (epoch ms) */
  e: number;
  /** phạm vi: với giấy tờ chi nhánh là `<gymId>:<docType>`; khiếu nại để trống */
  s: string;
}

function encodeIntent(p: IntentPayload): string {
  const body = b64u(Buffer.from(JSON.stringify(p), 'utf-8'));
  return `${body}.${sign(body)}`;
}

function decodeIntent(raw: unknown): IntentPayload {
  const invalid = () => new EvidenceUploadError(404, 'NOT_FOUND', 'Không tìm thấy lượt tải lên');
  if (typeof raw !== 'string' || raw.length > 2048) throw invalid();
  const [body, mac, ...rest] = raw.split('.');
  if (!body || !mac || rest.length) throw invalid();
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as IntentPayload;
    if (!p || !(p.k in KINDS) || typeof p.u !== 'string' || typeof p.t !== 'string' || typeof p.c !== 'string') throw invalid();
    return p;
  } catch {
    throw invalid();
  }
}

/** Tên tệp hợp lệ do SERVER sinh: `<userId>-<ms>-<hex>.<ext>` (cùng ký tự cho phép với luật xem tệp). */
export const EVIDENCE_TOKEN_RE = /^[a-zA-Z0-9_.-]+$/;

function newToken(userId: string, contentType: string): string {
  return `${userId}-${Date.now()}-${randomBytes(6).toString('hex')}.${extensionFor(contentType)}`;
}

export const evidenceKey = (kind: EvidenceKind, token: string) => `${KINDS[kind].prefix}/${token}`;

/** Content-Type theo đuôi tên tệp do server sinh — để ép loại nội dung khi đọc lại. */
export function contentTypeForToken(token: string): string | undefined {
  const ext = token.split('.').pop()?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'pdf' ? 'application/pdf' : undefined;
}

export const privateEvidenceUpload = {
  /** Xin phép tải lên: trả URL + các trường POST đã ký (loại và kích thước nằm trong policy S3). */
  async presign(params: { kind: EvidenceKind; userId: string; contentType: string; sizeBytes: number; scope?: string }) {
    const cfg = KINDS[params.kind];
    if (!partnerS3.isConfigured()) {
      throw new EvidenceUploadError(503, 'UPLOADS_UNAVAILABLE', 'Tính năng tải tệp chưa được cấu hình trên môi trường này');
    }
    if (!isAllowedContentType(cfg.uploadKind, params.contentType)) {
      throw new EvidenceUploadError(415, 'UNSUPPORTED_TYPE', cfg.rejectMessage);
    }
    if (!Number.isFinite(params.sizeBytes) || params.sizeBytes <= 0) {
      throw new EvidenceUploadError(400, 'INVALID_SIZE', 'Kích thước tệp không hợp lệ');
    }
    if (params.sizeBytes > cfg.maxBytes) {
      throw new EvidenceUploadError(413, 'FILE_TOO_LARGE', `Tệp tối đa ${Math.round(cfg.maxBytes / (1024 * 1024))} MB`);
    }

    const token = newToken(params.userId, params.contentType);
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
    const uploadId = encodeIntent({
      k: params.kind,
      u: params.userId,
      t: token,
      c: params.contentType,
      m: cfg.maxBytes,
      e: expiresAt.getTime(),
      s: params.scope ?? '',
    });
    const { url, fields } = await partnerS3.presignUpload({
      key: evidenceKey(params.kind, token),
      contentType: params.contentType,
      maxBytes: cfg.maxBytes,
    });
    return { uploadId, url, fields, method: 'POST' as const, maxBytes: cfg.maxBytes, contentType: params.contentType, expiresAt: expiresAt.toISOString() };
  },

  /**
   * Xác nhận sau khi tệp đã lên S3. Không tin client: HEAD lấy kích thước/loại thật, đọc 16 byte đầu nhận chữ ký, chỉ khi tất cả
   * khớp mới trả token. Sai thì XOÁ tệp. Lỗi "của người khác / sai phạm vi" cố ý cùng một thông báo 404 với "không có".
   */
  async confirm(params: { kind: EvidenceKind; userId: string; uploadId: unknown; scope?: string }): Promise<{ token: string }> {
    const cfg = KINDS[params.kind];
    const intent = decodeIntent(params.uploadId);
    if (intent.k !== params.kind || intent.u !== params.userId || intent.s !== (params.scope ?? '')) {
      throw new EvidenceUploadError(404, 'NOT_FOUND', 'Không tìm thấy lượt tải lên');
    }
    if (intent.e < Date.now()) throw new EvidenceUploadError(410, 'UPLOAD_EXPIRED', 'Lượt tải lên đã hết hạn — hãy thử lại');
    if (!partnerS3.isConfigured()) {
      throw new EvidenceUploadError(503, 'UPLOADS_UNAVAILABLE', 'Tính năng tải tệp chưa được cấu hình trên môi trường này');
    }

    const key = evidenceKey(intent.k, intent.t);
    const reject = async (reason: string): Promise<never> => {
      await partnerS3.deleteObject(key).catch((e) => logger.warn({ err: (e as Error).message }, 'Không xoá được tệp bị từ chối'));
      throw new EvidenceUploadError(422, 'UPLOAD_REJECTED', reason);
    };

    const head = await partnerS3.headObject(key);
    if (!head) throw new EvidenceUploadError(409, 'UPLOAD_NOT_FOUND', 'Chưa thấy tệp trên máy chủ — hãy tải lên rồi xác nhận lại');
    if (process.env.PARTNER_S3_REQUIRE_SSE === 'true' && !head.serverSideEncryption) {
      return reject('Tệp chưa được mã hoá phía máy chủ');
    }
    const firstBytes = await partnerS3.readHead(key);
    const check = validateStoredObject({
      kind: cfg.uploadKind,
      declaredContentType: intent.c,
      declaredMaxBytes: Math.min(intent.m, cfg.maxBytes),
      head,
      firstBytes,
    });
    if (!check.ok) return reject(check.reason);
    return { token: intent.t };
  },

  /** Tệp có tồn tại không (để /url trả 404 thay vì một link chết). */
  async exists(kind: EvidenceKind, token: string): Promise<boolean> {
    return (await partnerS3.headObject(evidenceKey(kind, token))) !== null;
  },

  /** Link xem ngắn hạn (presigned GET) — chỉ gọi SAU khi đã kiểm quyền xem. */
  async viewUrl(kind: EvidenceKind, token: string, expiresSec = 120): Promise<{ url: string; expiresInSec: number; contentType: string | null }> {
    const contentType = contentTypeForToken(token);
    const url = await partnerS3.presignGet({ key: evidenceKey(kind, token), contentType, attachment: false, expiresSec });
    return { url, expiresInSec: expiresSec, contentType: contentType ?? null };
  },
};

/**
 * Luật xem tệp bằng chứng — KHÔNG đổi so với bản cũ (xem serve của complaint-photo / branch-document-photo controller):
 * (1) tệp do CHÍNH bạn tải (tiền tố userId của token trùng), hoặc (2) bạn là ADMIN và token đã được đính kèm vào một dòng
 * khiếu nại / giấy tờ thật (chặn admin dò tệp chưa nộp bằng cách đoán token).
 */
export async function mayViewEvidence(params: {
  token: string;
  requester: { userId: string; role?: string | null };
  isAttached: (token: string) => Promise<boolean>;
}): Promise<'OK' | 'BAD_TOKEN' | 'FORBIDDEN'> {
  if (!EVIDENCE_TOKEN_RE.test(params.token)) return 'BAD_TOKEN';
  if (params.token.startsWith(`${params.requester.userId}-`)) return 'OK';
  if (params.requester.role !== 'ADMIN') return 'FORBIDDEN';
  return (await params.isAttached(params.token)) ? 'OK' : 'FORBIDDEN';
}
