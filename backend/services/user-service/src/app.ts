import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger, register, metricsMiddleware } from '@gym-coach/shared';
import profileRoutes from './routes/profile.routes';
import inbodyRoutes from './routes/inbody.routes';
import ptApplicationRoutes from './routes/pt_application.routes';
import contractRoutes from './routes/contract.routes';
import notificationRoutes from './routes/notification.routes';
import sessionRoutes from './routes/session.routes';
import availabilityRoutes from './routes/availability.routes';
import dropboxSignWebhookRouter from './routes/dropboxSignWebhook.routes';

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware());

// Ensure upload directories exist
for (const dir of ['uploads/pt-applications', 'uploads/profile-photos']) {
  const p = path.join(process.cwd(), dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Webhook: no auth (Dropbox Sign posts directly to this endpoint)
app.use('/webhooks/dropbox-sign', dropboxSignWebhookRouter);

app.use('/profile', profileRoutes);
app.use('/inbody', inbodyRoutes);
app.use('/pt-applications', ptApplicationRoutes);
app.use('/contracts', contractRoutes);
app.use('/notifications', notificationRoutes);
app.use('/sessions', sessionRoutes);
app.use('/availability', availabilityRoutes);

export default app;
