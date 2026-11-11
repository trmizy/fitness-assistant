import express from 'express';
import { metricsMiddleware, register } from '@gym-coach/shared';
import webhookRoutes from './routes/webhook.routes';
import vnpayReturnRoutes from './routes/vnpay-return.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import adminWithdrawalHistoryRoutes from './routes/admin-withdrawal-history.routes';
import adminWalletsRoutes from './routes/admin-wallets.routes';
import adminGatewayReconciliationRoutes from './routes/admin-gateway-reconciliation.routes';
import internalRoutes from './routes/internal.routes';
import walletRoutes from './routes/wallet.routes';

const app = express();

// Webhook MUST be mounted before express.json() so raw body is preserved for
// HMAC signature verification (ZaloPay, VNPay require the original bytes).
app.use('/payments/webhook', express.raw({ type: '*/*' }), webhookRoutes);

// VNPay return-URL (browser redirect after checkout) — GET, no body, no auth; the query
// string itself is HMAC-signed and verified inside.
app.use('/payments', vnpayReturnRoutes);

app.use(express.json());
app.use(metricsMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'payment-service' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/me/payments', paymentRoutes);
app.use('/me', walletRoutes);
// B8 (L2) read-only gateway reconciliation: before the generic admin router so no '/:id/...' route can shadow it.
app.use('/admin/payments/gateway-reconciliation', adminGatewayReconciliationRoutes);
// G-08 withdrawal history and G-09/G-10 wallet explorer (read-only): mounted before the generic admin router (11/11).
app.use('/admin/payments/withdrawal-history', adminWithdrawalHistoryRoutes);
app.use('/admin/payments/wallets', adminWalletsRoutes);
app.use('/admin/payments', adminRoutes);
app.use('/internal', internalRoutes);

export default app;
