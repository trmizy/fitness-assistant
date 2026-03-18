import nodemailer from 'nodemailer';
import { logger } from '@gym-coach/shared';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;
const SMTP_SECURE =
  (process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;

function assertSmtpConfig() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    return false;
  }

  return true;
}

export async function sendOtpEmail(
  to: string,
  otp: string,
  firstName?: string,
  expiresInMinutes = 10,
) {
  const hasSmtpConfig = assertSmtpConfig();
  if (!hasSmtpConfig) {
    if (process.env.NODE_ENV === 'production') {
      throw { status: 500, message: 'Email service not configured' };
    }

    logger.warn(
      { to, otp },
      'SMTP not configured. Using development OTP fallback.',
    );
    return { delivered: false as const };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const subject = 'Your AI Gym Coach verification code';
  const text = [
    `${greeting}`,
    '',
    `Your verification code is: ${otp}`,
    `It expires in ${expiresInMinutes} minutes.`,
    '',
    'If you did not request this, please ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;">
      <p>${greeting}</p>
      <p>Your verification code is:</p>
      <p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${otp}</p>
      <p>This code expires in ${expiresInMinutes} minutes.</p>
      <p>If you did not request this, please ignore this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
    html,
  });

  logger.info({ to }, 'OTP email sent');
  return { delivered: true as const };
}
