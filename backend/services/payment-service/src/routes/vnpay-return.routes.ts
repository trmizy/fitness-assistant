import { Router, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { buildSimulatedReturnQuery, isVnpaySimulateEnabled } from '../providers/vnpay.provider';
import { transactionRepository } from '../repositories/transaction.repository';
import { handleVnpayCallback } from '../services/vnpay-callback.service';
import { randomBytes } from 'crypto';
import {
  buildResultRedirect,
  uiStatusFromDbStatus,
  renderMobileReturnPage,
  MOBILE_DEEP_LINK_PREFIX,
  type ReturnUiStatus,
} from '../services/payment-return-redirect';

const router = Router();

// Single source of truth for "is the demo checkout on": VNPAY_SIMULATE=true AND not NODE_ENV=production
// (see vnpay.provider.ts — in production the flag is ignored and logged as an error).
const SIMULATE = isVnpaySimulateEnabled();

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
   <div class="row"><span>Nhà cung cấp</span><b>Gymini</b></div>
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
// The query string is signed (vnp_SecureHash), so a valid PAID result may credit here — but only after
// the SAME checks the IPN gets (signature, merchant, order exists, EXACT amount, not already confirmed;
// see handleVnpayCallback), and through the SAME idempotent handleEvent as IPN/sync, which guarantees
// single credit whichever of IPN / return / poll arrives first. A browser-supplied query is never a
// weaker door than the server-to-server IPN.
// The UI must still confirm via POST /me/wallet/topup/:id/sync; the redirect status is
// display-only and never trusted by the frontend.
router.get('/vnpay/return', async (req: Request, res: Response) => {
  const rawQuery = req.originalUrl.split('?')[1] ?? '';
  const txnRef = typeof req.query.vnp_TxnRef === 'string' ? req.query.vnp_TxnRef : '';

  let uiStatus: 'success' | 'failed' | 'invalid' = 'invalid';
  try {
    const result = await handleVnpayCallback(rawQuery, 'RETURN');
    uiStatus = result.uiStatus;
  } catch (err) {
    logger.error({ error: '[VNPayReturn] processing failed', txnRef, message: (err as Error).message });
  }

  // Send the payer's browser to the right home: the app's own deep link if this checkout
  // started on mobile (see checkoutSchema's `platform` in internal.routes.ts — persisted on
  // the transaction at create time, since by now the original request is long gone), the web
  // result page otherwise. Never trust `uiStatus` here either way — both destinations re-ask
  // the server via POST /me/payments/:id/sync before showing anything.
  // (BUG FIX 2026-09-06: the web base is the payer's real origin persisted on the transaction as
  // `returnBaseUrl`, not the static .env FRONTEND_URL — see payment-return-redirect.ts.)
  return res.redirect(302, await buildResultRedirect(txnRef, uiStatus));
});

// GET /payments/zalopay/return — ZaloPay's gateway page does NOT navigate to a custom scheme
// (`fitnessassistant://`), so a mobile checkout stayed on "THANH TOÁN THÀNH CÔNG" forever. Like VNPay,
// ZaloPay now returns to this https route, which 302s on to the app's deep link (mobile) or the web
// result page. NOTHING is marked paid here: ZaloPay's appended query (status, apptransid, checksum...)
// is unsigned from our side, money is only ever settled by the signed server-to-server callback /
// sync. The status shown is derived from OUR stored transaction (pending until that lands) and the
// result screen re-asks POST /me/payments/:id/sync anyway. Unknown/missing txnId never errors.
router.get('/zalopay/return', async (req: Request, res: Response) => {
  const txnId = typeof req.query.txnId === 'string' ? req.query.txnId : '';
  let uiStatus: ReturnUiStatus = 'pending';
  try {
    const txn = txnId ? await transactionRepository.findById(txnId) : null;
    uiStatus = uiStatusFromDbStatus(txn?.status);
  } catch (err) {
    logger.error({ error: '[ZaloPayReturn] processing failed', txnId, message: (err as Error).message });
  }
  const target = await buildResultRedirect(txnId, uiStatus);
  if (target.startsWith(MOBILE_DEEP_LINK_PREFIX)) {
    // Mobile: a 302 to the custom scheme is blocked by Chrome Custom Tabs when no user gesture precedes it
    // (ZaloPay auto-redirects), leaving a white tab. Serve a tap-to-return page instead (REAL DEVICE 20/11).
    const nonce = randomBytes(16).toString('base64');
    return res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`,
      })
      .send(renderMobileReturnPage(txnId, uiStatus, nonce));
  }
  return res.redirect(302, target);
});

export default router;
