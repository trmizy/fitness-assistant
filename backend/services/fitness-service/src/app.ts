import express from 'express';
import { metricsMiddleware, register } from '@gym-coach/shared';
import exerciseRoutes from './routes/exercise.routes';
import workoutRoutes from './routes/workout.routes';
import nutritionRoutes from './routes/nutrition.routes';
import statsRoutes from './routes/stats.routes';

const app = express();

app.use(express.json());
app.use(metricsMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fitness-service' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/exercises', exerciseRoutes);
app.use('/workouts', workoutRoutes);
app.use('/nutrition', nutritionRoutes);
app.use('/stats', statsRoutes);

export default app;
