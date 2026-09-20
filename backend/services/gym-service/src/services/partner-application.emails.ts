import { logger } from '@gym-coach/shared';
import { authClient } from '../clients/auth.client';

/**
 * Nội dung email của hồ sơ đối tác tự đăng ký. Không có hệ thống template nào trong repo — mọi
 * email đều là chuỗi dựng tại chỗ (cùng cách auth-service và partner.controller đang làm). Không
 * SMS. Email chỉ là thông báo; sự thật nằm ở trạng thái hồ sơ trên hệ thống.
 */

interface Mail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function build(subject: string, paragraphs: string[]): Mail {
  return {
    subject,
    text: paragraphs.join('\n\n'),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;">${paragraphs
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join('')}</div>`,
  };
}

export const applicantEmails = {
  submitted: () =>
    build('Gymini đã nhận hồ sơ đối tác của bạn', [
      'Xin chào,',
      'Gymini đã nhận được hồ sơ đối tác của bạn và đang xem xét. Chúng tôi sẽ thông báo qua email khi có kết quả hoặc khi cần bạn bổ sung thông tin.',
      'Trong lúc chờ, bạn vẫn có thể đăng nhập để xem trạng thái hồ sơ.',
    ]),

  resubmitted: () =>
    build('Gymini đã nhận hồ sơ đối tác đã chỉnh sửa của bạn', [
      'Xin chào,',
      'Cảm ơn bạn đã cập nhật hồ sơ. Gymini sẽ xem xét lại các nội dung đã sửa và báo kết quả qua email.',
    ]),

  changesRequested: (issueCount: number, documentCount: number) => {
    const parts: string[] = [];
    if (issueCount > 0) parts.push(`${issueCount} nội dung`);
    if (documentCount > 0) parts.push(`${documentCount} giấy tờ`);
    return build('Gymini cần bạn cập nhật hồ sơ đối tác', [
      'Xin chào,',
      `Gymini cần bạn cập nhật ${parts.join(' và ') || 'hồ sơ'} trước khi tiếp tục xét duyệt.`,
      'Hãy đăng nhập để xem chi tiết từng mục cần sửa, cập nhật rồi gửi lại hồ sơ.',
    ]);
  },

  approved: () =>
    build('Chào mừng bạn trở thành đối tác Gymini', [
      'Xin chào,',
      'Hồ sơ đối tác của bạn đã được phê duyệt. Bạn đã có thể đăng nhập và vào trang quản lý phòng gym.',
      'Nếu còn bước thiết lập (ví dụ thông tin nhận tiền), hệ thống sẽ hướng dẫn bạn ngay sau khi đăng nhập.',
    ]),

  rejected: (reason: string) =>
    build('Hồ sơ đối tác chưa được chấp thuận', [
      'Xin chào,',
      'Rất tiếc, hồ sơ đối tác của bạn chưa được Gymini chấp thuận.',
      `Lý do: ${reason}`,
      'Nếu cần hỗ trợ hoặc muốn trao đổi thêm, hãy liên hệ Gymini.',
    ]),
};

/**
 * Gửi email hồ sơ — CHẠY SAU COMMIT, lỗi gửi chỉ được log (không rollback, không tuyên bố atomic cho
 * email). Ở chế độ E2E/dev (`PARTNER_APPLICATION_DEV_ECHO=true`, bị bỏ qua khi NODE_ENV=production)
 * KHÔNG gửi thật: địa chỉ thử nghiệm không nên nhận thư và không nên sinh thư báo lỗi về hộp thư
 * gửi; nội dung chỉ được ghi log.
 */
export async function sendApplicantMail(to: string | null | undefined, mail: Mail): Promise<void> {
  if (!to) return;
  if (process.env.PARTNER_APPLICATION_DEV_ECHO === 'true' && process.env.NODE_ENV !== 'production') {
    logger.info({ to, subject: mail.subject }, '[dev-echo] bỏ qua gửi email hồ sơ đối tác');
    return;
  }
  try {
    await authClient.sendEmail({ to, ...mail });
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'Partner application email failed');
  }
}
