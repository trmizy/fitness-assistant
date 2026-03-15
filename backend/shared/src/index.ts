import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

export * from './types';
export * from './schemas';
export * from './errors';
export * from './metrics';
