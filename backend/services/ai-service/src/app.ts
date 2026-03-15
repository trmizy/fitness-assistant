import express from 'express';
import { metricsMiddleware, register } from '@gym-coach/shared';
import aiRoutes from './routes/ai.routes';

const app = express();

app.use(express.json());
app.use(metricsMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ai-service' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/ai', aiRoutes);

export default app;
