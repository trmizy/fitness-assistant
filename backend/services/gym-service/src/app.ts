import express from 'express';
import { metricsMiddleware, register } from '@gym-coach/shared';
import publicRoutes from './routes/public.routes';
import ownerRoutes from './routes/owner.routes';
import clientRoutes from './routes/client.routes';
import ptRoutes from './routes/pt.routes';
import adminRoutes from './routes/admin.routes';
import internalRoutes from './routes/internal.routes';

const app = express();

app.use(express.json());
app.use(metricsMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gym-service' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/', publicRoutes);
app.use('/owner', ownerRoutes);
app.use('/', clientRoutes);
app.use('/', ptRoutes);
app.use('/admin', adminRoutes);
app.use('/internal', internalRoutes);

export default app;
