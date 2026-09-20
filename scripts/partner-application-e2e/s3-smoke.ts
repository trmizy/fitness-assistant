/**
 * Smoke test CHỈ CHẠM S3 — dùng để nghiệm thu bucket AWS thật trước khi deploy (mục G1 trong
 * GYM_PARTNER_WEB_KNOWN_ISSUES.md).
 *
 * Cố ý KHÔNG dùng `api-e2e.mjs` cho việc này: script đó tạo người dùng và hồ sơ thật trong CSDL, nên
 * trỏ nó vào Aurora dev sẽ ghi dữ liệu thử vào cơ sở dữ liệu thật. Ở đây không có CSDL, không có HTTP
 * của ứng dụng, không có người dùng nào — chỉ gọi thẳng module lưu trữ và dọn sạch sau khi xong.
 *
 * Kiểm đúng những thứ chỉ S3 thật mới trả lời được: điều kiện đã ký của presigned POST có được S3
 * cưỡng chế không, mã hoá phía máy chủ có bật không, presigned GET và việc bỏ chữ ký, xoá đối tượng,
 * và CORS cho origin của web.
 *
 * KHÔNG kiểm được: policy IAM hẹp của role gym-service có đủ không. Script chạy bằng credential nào
 * thì kiểm quyền của credential đó; muốn nghiệm thu policy thật thì phải chạy chính hàm Lambda với
 * role đó, tức là ở bước deploy. Xem mục G1 trong GYM_PARTNER_WEB_KNOWN_ISSUES.md.
 *
 * Chạy (không đặt khoá trong dòng lệnh — SDK tự đọc ~/.aws/credentials):
 *   cd backend/services/gym-service
 *   PARTNER_S3_PRIVATE_BUCKET=<tên bucket> PARTNER_S3_REGION=ap-southeast-1 \
 *   PARTNER_S3_SMOKE_ORIGIN=<origin web> npx tsx ../../../scripts/partner-application-e2e/s3-smoke.ts
 *
 * Với MinIO cục bộ thì thêm PARTNER_S3_ENDPOINT / PARTNER_S3_PUBLIC_ENDPOINT / FORCE_PATH_STYLE và
 * khoá dev như docker-compose.dev.yml đang đặt.
 */
import { randomUUID } from 'crypto';
import { partnerS3 } from '../../backend/services/gym-service/src/services/partner-s3.service';
import { partnerS3ProductionViolations } from '../../backend/services/gym-service/src/services/partner-s3.guard';
import { validateStoredObject } from '../../backend/services/gym-service/src/services/partner-upload.rules';

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
};
const info = (...a: unknown[]) => console.log('   ·', ...a);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(512, 7)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(200));

const BUCKET = process.env.PARTNER_S3_PRIVATE_BUCKET ?? '';
const ORIGIN = process.env.PARTNER_S3_SMOKE_ORIGIN ?? 'http://localhost:5173';
const isRealAws = !process.env.PARTNER_S3_ENDPOINT;

/** Tải lên đúng như trình duyệt làm: POST multipart với các trường đã ký. */
async function browserUpload(auth: { url: string; fields: Record<string, string> }, body: Buffer, contentType: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(auth.fields)) form.append(k, v);
  form.append('file', new Blob([body], { type: contentType }), 'upload.bin');
  return fetch(auth.url, { method: 'POST', body: form });
}

async function main() {
  if (!BUCKET) throw new Error('Thiếu PARTNER_S3_PRIVATE_BUCKET');
  console.log(`Bucket: ${BUCKET} · ${isRealAws ? 'AWS S3 THẬT' : 'kho tương thích cục bộ'} · origin CORS: ${ORIGIN}\n`);

  // Mọi khoá nằm dưới partner-applications/smoke-test/ — vừa đúng prefix mà IAM của gym-service cho
  // phép, vừa tách hẳn khỏi dữ liệu thật để grep/xoá thủ công được nếu có gì sót lại.
  const key = `partner-applications/smoke-test/${randomUUID()}/probe.png`;
  const cleanup: string[] = [];

  try {
    check('cấu hình đọc được, bucket đã cấu hình', partnerS3.isConfigured());

    // Cấu hình production phải qua được guard — chứng minh hình dạng biến môi trường là hợp lệ.
    const prodShape = {
      NODE_ENV: 'production',
      PARTNER_S3_PRIVATE_BUCKET: BUCKET,
      PARTNER_S3_REGION: process.env.PARTNER_S3_REGION,
      PARTNER_S3_REQUIRE_SSE: 'true',
    };
    const violations = partnerS3ProductionViolations(prodShape);
    check('hình dạng biến môi trường production qua được guard', violations.length === 0, violations.join('; '));

    // ── 1. Đường đi đúng ────────────────────────────────────────────────────────────────────
    const auth = await partnerS3.presignUpload({ key, contentType: 'image/png', maxBytes: 10 * 1024 * 1024 });
    check('presign trả về URL + các trường đã ký', Boolean(auth.url && auth.fields));
    cleanup.push(key);

    const up = await browserUpload(auth, PNG, 'image/png');
    check('trình duyệt POST thẳng lên kho thành công', [200, 201, 204].includes(up.status), `status=${up.status}`);

    const head = await partnerS3.headObject(key);
    check('HEAD thấy đối tượng với đúng kích thước', head?.contentLength === PNG.length, `size=${head?.contentLength}`);
    check('HEAD trả về đúng content-type đã ký', head?.contentType === 'image/png', `type=${head?.contentType}`);
    info('mã hoá phía máy chủ:', head?.serverSideEncryption ?? '(không có)');
    if (isRealAws) {
      check('bucket bật mã hoá mặc định (PARTNER_S3_REQUIRE_SSE=true sẽ dùng được)', Boolean(head?.serverSideEncryption), String(head?.serverSideEncryption));
    }

    const first = await partnerS3.readHead(key);
    const verdict = validateStoredObject({
      kind: 'PHOTO',
      declaredContentType: 'image/png',
      declaredMaxBytes: 10 * 1024 * 1024,
      head: head!,
      firstBytes: first,
    });
    check('đọc được đầu tệp và qua được kiểm chữ ký định dạng', verdict.ok, verdict.ok ? '' : verdict.reason);

    // ── 2. Đọc lại bằng presigned GET ───────────────────────────────────────────────────────
    const getUrl = await partnerS3.presignGet({ key, contentType: 'image/png', attachment: false, expiresSec: 120 });
    check('presigned GET có chữ ký', /X-Amz-Signature=/i.test(getUrl));
    const signed = await fetch(getUrl);
    check('presigned GET tải về được đúng số byte', signed.status === 200 && (await signed.arrayBuffer()).byteLength === PNG.length, `status=${signed.status}`);

    const bare = await fetch(getUrl.split('?')[0]);
    check('bỏ chữ ký đi thì bị từ chối (đối tượng KHÔNG công khai)', bare.status === 401 || bare.status === 403, `status=${bare.status}`);

    // ── 3. Điều kiện đã ký phải được KHO cưỡng chế, không chỉ ứng dụng ──────────────────────
    const smallAuth = await partnerS3.presignUpload({ key: `${key}.toobig`, contentType: 'image/png', maxBytes: 100 });
    const tooBig = await browserUpload(smallAuth, PNG, 'image/png');
    check('kho tự từ chối tệp vượt content-length-range đã ký', tooBig.status >= 400, `status=${tooBig.status}`);
    if (tooBig.status < 400) cleanup.push(`${key}.toobig`);

    // Điều kiện đã ký là `eq $Content-Type`, tức TRƯỜNG Content-Type của form — không phải kiểu MIME
    // của phần tệp. Muốn thử đúng cái kho cưỡng chế thì phải sửa chính trường đó, như một client cố ý
    // khai khác với thứ server đã ký.
    const typeAuth = await partnerS3.presignUpload({ key: `${key}.wrongtype`, contentType: 'image/png', maxBytes: 10 * 1024 * 1024 });
    const tampered = { ...typeAuth, fields: { ...typeAuth.fields, 'Content-Type': 'text/html' } };
    const wrongType = await browserUpload(tampered, HTML, 'text/html');
    check('kho tự từ chối khi client sửa Content-Type khác với điều kiện đã ký', wrongType.status >= 400, `status=${wrongType.status}`);
    if (wrongType.status < 400) cleanup.push(`${key}.wrongtype`);

    // ── 4. CORS cho trình duyệt ─────────────────────────────────────────────────────────────
    const preflightUrl = auth.url.endsWith('/') ? auth.url : `${auth.url}/`;
    const preflight = await fetch(preflightUrl, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    const allowOrigin = preflight.headers.get('access-control-allow-origin');
    const allowMethods = (preflight.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    info('preflight:', preflight.status, '| allow-origin:', allowOrigin, '| allow-methods:', allowMethods || '(không có)');
    check('CORS cho phép origin của web', allowOrigin === ORIGIN || allowOrigin === '*', String(allowOrigin));
    check('CORS cho phép POST (presigned POST cần POST, không phải PUT)', allowMethods.includes('POST'), allowMethods);

    // ── 5. Xoá ──────────────────────────────────────────────────────────────────────────────
    await partnerS3.deleteObject(key);
    check('xoá xong thì đối tượng biến mất', (await partnerS3.headObject(key)) === null);
    cleanup.splice(cleanup.indexOf(key), 1);
  } finally {
    for (const k of cleanup) {
      await partnerS3.deleteObject(k).catch(() => undefined);
    }
    if (cleanup.length) info('đã dọn thêm', cleanup.length, 'đối tượng còn sót');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} đạt`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('SCRIPT ERROR:', (e as Error).message);
  process.exitCode = 2;
});
