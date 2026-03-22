import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger, register, metricsMiddleware } from '@gym-coach/shared';
import profileRoutes from './routes/profile.routes';
import inbodyRoutes from './routes/inbody.routes';
import ptApplicationRoutes from './routes/pt_application.routes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/profile', profileRoutes);
app.use('/inbody', inbodyRoutes);
app.use('/pt-applications', ptApplicationRoutes);

export default app;
