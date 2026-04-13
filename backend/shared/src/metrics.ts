import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const register = new Registry();

// HTTP metrics
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Database metrics
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
  registers: [register],
});

export const dbQueryTotal = new Counter({
  name: 'db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'status'],
  registers: [register],
});

// Cache metrics
export const cacheHitTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_type'],
  registers: [register],
});

export const cacheMissTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_type'],
  registers: [register],
});

// Queue metrics
export const queueJobTotal = new Counter({
  name: 'queue_jobs_total',
  help: 'Total number of queue jobs',
  labelNames: ['queue', 'status'],
  registers: [register],
});

export const queueJobDuration = new Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of queue jobs in seconds',
  labelNames: ['queue'],
  registers: [register],
});

// Active connections
export const activeConnections = new Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  labelNames: ['type'],
  registers: [register],
});

// Middleware for Express
export function metricsMiddleware() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const route = req.route?.path || req.path || 'unknown';
      
      httpRequestDuration.observe(
        { method: req.method, route, status_code: res.statusCode },
        duration
      );
      
      httpRequestTotal.inc({
        method: req.method,
        route,
        status_code: res.statusCode,
      });
    });

    next();
  };
}

// ── Business Metrics: OCR / InBody ──────────────────────────────────────────

export const ocrExtractionsTotal = new Counter({
  name: 'ocr_extractions_total',
  help: 'Total number of OCR extraction attempts',
  labelNames: ['status'],
  registers: [register],
});

export const ocrExtractionDuration = new Histogram({
  name: 'ocr_extraction_duration_seconds',
  help: 'Duration of OCR extraction in seconds',
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [register],
});

export const inbodyUploadsTotal = new Counter({
  name: 'inbody_uploads_total',
  help: 'Total number of InBody data entries',
  labelNames: ['method'],
  registers: [register],
});

// ── Business Metrics: PT Application ────────────────────────────────────────

export const ptApplicationsTotal = new Counter({
  name: 'pt_applications_total',
  help: 'Total PT application status transitions',
  labelNames: ['status'],
  registers: [register],
});

// ── Business Metrics: AI Coach ──────────────────────────────────────────────

export const aiCoachQueriesTotal = new Counter({
  name: 'ai_coach_queries_total',
  help: 'Total number of AI coach queries',
  labelNames: ['status'],
  registers: [register],
});

export const aiCoachQueryDuration = new Histogram({
  name: 'ai_coach_query_duration_seconds',
  help: 'Duration of AI coach query processing in seconds',
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [register],
});

export const aiPlanGenerationsTotal = new Counter({
  name: 'ai_plan_generations_total',
  help: 'Total AI plan generation requests',
  labelNames: ['status'],
  registers: [register],
});

// ── Business Metrics: Chat / WebSocket ──────────────────────────────────────

export const websocketConnectionsActive = new Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

export const chatMessagesTotal = new Counter({
  name: 'chat_messages_total',
  help: 'Total chat messages sent via WebSocket',
  registers: [register],
});

