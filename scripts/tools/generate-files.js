#!/usr/bin/env node

/**
 * Quick Setup Script for AI Gym Coach
 * Generates all remaining boilerplate files
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Generating remaining project files...\n');

// Create directory if not exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Template files
const templates = {
  'services/fitness-service/src/routes/workout.routes.ts': `import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { createWorkoutLogSchema, successResponse, paginatedResponse } from '@gym-coach/shared';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

router.post('/log', async (req: AuthRequest, res, next) => {
  try {
    const input = createWorkoutLogSchema.parse(req.body);
    const log = await prisma.workoutLog.create({
      data: {
        userId: req.userId!,
        exerciseId: input.exerciseId,
        date: new Date(input.date),
        sets: input.sets as any,
        notes: input.notes,
      },
      include: { exercise: true },
    });
    res.json(successResponse(log));
  } catch (error) {
    next(error);
  }
});

router.get('/history', async (req: AuthRequest, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const skip = (page - 1) * pageSize;

    const [logs, total] = await Promise.all([
      prisma.workoutLog.findMany({
        where: { userId: req.userId! },
        include: { exercise: true },
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.workoutLog.count({ where: { userId: req.userId! } }),
    ]);

    res.json(paginatedResponse(logs, page, pageSize, total));
  } catch (error) {
    next(error);
  }
});

router.get('/exercises', async (req, res, next) => {
  try {
    const exercises = await prisma.exercise.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(successResponse(exercises));
  } catch (error) {
    next(error);
  }
});

export { router as workoutRouter };`,

  'services/fitness-service/src/routes/planning.routes.ts': `import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { successResponse } from '@gym-coach/shared';
import { AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

router.post('/workout/generate', async (req: AuthRequest, res, next) => {
  try {
    const profile = await prisma.userProfile.findUnique({ where: { userId: req.userId! } });
    if (!profile) {
      return res.status(400).json({ error: 'Profile required' });
    }

    // Simple plan generation
    const plan = {
      weeks: [
        {
          monday: [{ exerciseId: '1', sets: 3, reps: '8-12', restSeconds: 90 }],
          wednesday: [{ exerciseId: '2', sets: 3, reps: '8-12', restSeconds: 90 }],
          friday: [{ exerciseId: '3', sets: 3, reps: '8-12', restSeconds: 90 }],
        },
      ],
    };

    const savedPlan = await prisma.workoutPlan.create({
      data: {
        userId: req.userId!,
        name: 'Generated Workout Plan',
        startDate: new Date(),
        endDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
        weeklySchedule: plan as any,
        status: 'ACTIVE',
        createdBy: 'system',
      },
    });

    res.json(successResponse(savedPlan));
  } catch (error) {
    next(error);
  }
});

router.get('/current', async (req: AuthRequest, res, next) => {
  try {
    const workoutPlan = await prisma.workoutPlan.findFirst({
      where: { userId: req.userId!, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    res.json(successResponse({ workoutPlan }));
  } catch (error) {
    next(error);
  }
});

export { router as planningRouter };`,

  'services/fitness-service/src/routes/health.routes.ts': `import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  try {
    await prisma.$queryRaw\`SELECT 1\`;
    res.json({ status: 'healthy', service: 'fitness-service', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy' });
  }
});

export { router as healthRouter };`,

  'services/fitness-service/Dockerfile': `FROM node:20-alpine AS base
RUN npm install -g pnpm

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY services/fitness-service/package.json ./services/fitness-service/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY packages/ ./packages/
COPY services/fitness-service/ ./services/fitness-service/
COPY tsconfig.base.json ./
RUN pnpm --filter @gym-coach/shared build
RUN pnpm --filter @gym-coach/fitness-service build
RUN cd services/fitness-service && pnpm prisma generate

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/services/fitness-service/dist ./services/fitness-service/dist
COPY --from=builder /app/services/fitness-service/node_modules ./services/fitness-service/node_modules
COPY --from=builder /app/services/fitness-service/package.json ./services/fitness-service/
COPY --from=builder /app/services/fitness-service/prisma ./services/fitness-service/prisma
WORKDIR /app/services/fitness-service
EXPOSE 3002
CMD ["node", "dist/main.js"]`,

  'services/fitness-service/tsconfig.json': `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "prisma"]
}`,
};

// Generate files
Object.entries(templates).forEach(([filepath, content]) => {
  const fullPath = path.join(process.cwd(), filepath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✅ Created: ${filepath}`);
});

console.log('\n✨ File generation complete!\n');
console.log('📋 Next steps:');
console.log('  1. pnpm install');
console.log('  2. docker-compose up -d postgres redis qdrant');
console.log('  3. pnpm run db:generate');
console.log('  4. pnpm run db:migrate');
console.log('  5. pnpm dev\n');
