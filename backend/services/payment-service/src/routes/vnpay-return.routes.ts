import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { getProvider } from '../services/payment.service';
import { buildSimulatedReturnQuery } from '../providers/vnpay.provider';
import { transactionRepository } from '../repositories/transaction.repository';
import { handleEvent } from '../services/webhook.service';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const SIMULATE = (process.env.VNPAY_SIMULATE ?? 'false').toLowerCase() === 'true';

// GET /payments/vnpay/sim?txnId=... — DEMO checkout page (only when VNPAY_SIMULATE=true).
// Replaces VNPay's hosted page for a graduation demo with no real money / no live merchant.
// The two buttons link to the REAL return handler with a query signed by our HASH_SECRET.
router.get('/vnpay/sim', async (req: Request, res: Response) => {
  if (!SIMULATE) return res.status(404).send('Not found');
  const txnId = typeof req.query.txnId === 'string' ? req.query.txnId : '';
  const txn = await transactionRepository.findById(txnId);
  if (!txn) return res.status(404).send('Transaction not found');

  const amount = Number(txn.amount);
  const amountVnd = amount.toLocaleString('vi-VN');
  const okUrl = `/payments/vnpay/return?${buildSimulatedReturnQuery({ txnRef: txnId, amount, success: true })}`;
  const failUrl = `/payments/vnpay/return?${buildSimulatedReturnQuery({ txnRef: txnId, amount, success: false })}`;

  return res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VNPAY — Cổng thanh toán (DEMO)</title>
<style>
 body{font-family:Arial,Helvetica,sans-serif;background:#eef1f5;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
 .card{background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.12);width:380px;overflow:hidden}
 .hd{background:#004a99;color:#fff;padding:16px 20px;font-weight:bold;font-size:20px;letter-spacing:1px;display:flex;justify-content:space-between;align-items:center}
 .hd small{font-weight:normal;font-size:11px;opacity:.85}
 .bd{padding:22px 20px}
 .row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px dashed #e3e3e3;font-size:14px;color:#333}
 .row b{color:#111}
 .amt{font-size:26px;color:#c60000;font-weight:bold;text-align:right;margin:14px 0 6px}
 .note{background:#fff8e1;border:1px solid #ffe082;color:#8a6d00;font-size:12px;padding:8px 10px;border-radius:8px;margin:12px 0}
 a.btn{display:block;text-align:center;text-decoration:none;padding:13px;border-radius:9px;font-weight:bold;margin-top:10px}
 .pay{background:#0a7d28;color:#fff}
 .cancel{background:#f1f1f1;color:#555}
</style></head>
<body><div class="card">
 <div class="hd"><span>VNPAY<small> QR</small></span><small>MÔI TRƯỜNG DEMO</small></div>
 <div class="bd">
   <div class="row"><span>Nhà cung cấp</span><b>AI Gym Coach</b></div>
   <div class="row"><span>Nội dung</span><b>Nạp ví</b></div>
   <div class="row"><span>Mã giao dịch</span><b style="font-size:11px">${txnId.slice(0, 18)}…</b></div>
   <div class="amt">${amountVnd} ₫</div>
   <div class="note">🧪 Trang mô phỏng cho đồ án — không phát sinh tiền thật. Bấm nút bên dưới để giả lập kết quả từ VNPAY.</div>
   <a class="btn pay" href="${okUrl}">✔ Thanh toán thành công</a>
   <a class="btn cancel" href="${failUrl}">✖ Hủy / Thất bại</a>
 </div>
</div></body></html>`);
});

// GET /payments/vnpay/return — where VNPay redirects the payer's browser after checkout.
// The query string is signed (vnp_SecureHash), so a valid PAID result may credit here —
// through the SAME idempotent handleEvent as IPN/sync, which guarantees single credit.
// The UI must still confirm via POST /me/wallet/topup/:id/sync; the redirect status is
// display-only and never trusted by the frontend.
router.get('/vnpay/return', async (req: Request, res: Response) => {
  const rawQuery = req.originalUrl.split('?')[1] ?? '';
  const txnRef = typeof req.query.vnp_TxnRef === 'string' ? req.query.vnp_TxnRef : '';

  let uiStatus: 'success' | 'failed' | 'invalid' = 'invalid';
  try {
    const { valid, normalized } = getProvider('VNPAY').verifyWebhookSignature(Buffer.from(rawQuery, 'utf-8'));
    if (valid && normalized) {
      uiStatus = normalized.status === 'PAID' ? 'success' : 'failed';
      if (normalized.status === 'PAID') {
        await handleEvent({
          provider: 'VNPAY',
          providerEventId: `vnpay_return_${normalized.providerTransactionId}`,
          providerTransactionId: normalized.providerTransactionId,
          payload: normalized.raw ?? {},
          status: 'PAID',
        });
      }
    }
  } catch (err) {
    logger.error({ error: '[VNPayReturn] processing failed', txnRef, message: (err as Error).message });
  }

  // Send the payer's browser to the right home: the app's own deep link if this checkout
  // started on mobile (see checkoutSchema's `platform` in internal.routes.ts — persisted on
  // the transaction at create time, since by now the original request is long gone), the web
  // result page otherwise. Never trust `uiStatus` here either way — both destinations re-ask
  // the server via POST /me/payments/:id/sync before showing anything.
  const txn = await transactionRepository.findById(txnRef).catch(() => null);
  const meta = txn?.metadata as Record<string, unknown> | null;
  const platform = meta?.platform === 'mobile' ? 'mobile' : 'web';
  // BUG FIX (2026-09-06): fell back to the static .env FRONTEND_URL unconditionally — the
  // one hardcoded LAN IP/host that, unlike everything else in this file, was never wired to
  // the payer's actual origin. Reproduced live: a real ZaloPay-class redirect ended up on a
  // host the browser couldn't reach; VNPay's OWN return trip (this handler) had the identical
  // exposure one hop further down its own two-hop chain. `returnBaseUrl` is now persisted on
  // the transaction at checkout time (internal.routes.ts) for exactly this read-back — same
  // pattern this file already used for `platform` above, just never extended to this value.
  const webBase = typeof meta?.returnBaseUrl === 'string' ? meta.returnBaseUrl : FRONTEND_URL;
  const target = platform === 'mobile'
    ? `fitnessassistant://client/payments/result?txnId=${encodeURIComponent(txnRef)}&status=${uiStatus}`
    : `${webBase}/client/payments/result?txnId=${encodeURIComponent(txnRef)}&status=${uiStatus}`;
  return res.redirect(302, target);
});

export default router;
