import express from 'express';
import { metricsMiddleware, register } from '@gym-coach/shared';
import webhookRoutes from './routes/webhook.routes';
import vnpayReturnRoutes from './routes/vnpay-return.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import internalRoutes from './routes/internal.routes';
import walletRoutes from './routes/wallet.routes';

const app = express();

// On AWS every API Gateway route is ANY, so CORS preflight (OPTIONS) reaches this Lambda, where router-level auth
// (e.g. /admin) answers 401 — browsers reject a non-2xx preflight and the page shows "Network Error". API Gateway's own
// CORS config supplies the Access-Control-* headers; this only has to answer 2xx before any auth runs.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Webhook MUST be mounted before express.json() so raw body is preserved for
// HMAC signature verification (MoMo, VNPay require the original bytes).
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
app.use('/admin/payments', adminRoutes);
app.use('/internal', internalRoutes);

export default app;
