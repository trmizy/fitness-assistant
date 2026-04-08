import { Router, Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from '@gym-coach/shared';
import { authMiddleware, requireRoles } from '../middleware/auth.middleware';
import axios from 'axios';

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:3004';
const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3003';
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || 'http://localhost:3005';
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';
const N8N_EDITOR_BASE_PATH = process.env.N8N_EDITOR_BASE_PATH || '/admin/workflows/studio';
const N8N_PUBLIC_API_KEY = process.env.N8N_PUBLIC_API_KEY;
const N8N_BASIC_AUTH_USER = process.env.N8N_BASIC_AUTH_USER;
const N8N_BASIC_AUTH_PASSWORD = process.env.N8N_BASIC_AUTH_PASSWORD;

function normalizeSetCookiePath(headerValue: string | string[] | undefined): string[] | undefined {
  if (!headerValue) return undefined;
  const values = Array.isArray(headerValue) ? headerValue : [headerValue];
  return values.map((cookie) => {
    let normalized = cookie;
    if (/;\s*Path=/i.test(normalized)) {
      normalized = normalized.replace(/;\s*Path=[^;]*/i, '; Path=/');
    } else {
      normalized = `${normalized}; Path=/`;
    }

    // n8n may issue Secure cookies by default. Strip it for local HTTP gateway
    // usage so browser can persist session on http://localhost.
    normalized = normalized.replace(/;\s*Secure/gi, '');

    return normalized;
  });
}

type ProbeService = {
  key: 'api' | 'auth' | 'user' | 'fitness' | 'ai' | 'chat' | 'n8n';
  name: string;
  url: string;
  healthPath?: string; // override default '/health' path
  optional?: boolean;  // true = down state doesn't lower core health score
};

type ProbeResult = {
  key: ProbeService['key'];
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  statusCode: number;
  latencyMs: number;
  uptimeSeconds: number | null;
  timestamp: string;
  error: string | null;
  optional?: boolean; // true = down state doesn't lower health score
};

type AuthUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'ADMIN' | 'CUSTOMER' | 'PT';
  createdAt: string;
  updatedAt: string;
};

type PTProfile = {
  userId: string;
  isPT: boolean;
};

type N8nWorkflow = {
  id: string;
  name: string;
  active: boolean;
  updatedAt?: string;
  createdAt?: string;
  tags?: Array<{ id: string; name: string }>;
};

type N8nExecution = {
  id: string;
  workflowId: string;
  finished: boolean;
  mode: string;
  status: 'success' | 'error' | 'running' | 'waiting' | 'crashed' | 'canceled';
  startedAt: string;
  stoppedAt?: string;
  workflowData?: { id: string; name: string };
};

type N8nSettingsData = {
  userManagement?: {
    showSetupOnFirstLoad?: boolean;
  };
};

const N8N_SMOKE_TEST_WEBHOOK_URL = process.env.N8N_SMOKE_TEST_WEBHOOK_URL;
const N8N_E2E_WEBHOOK_URL = process.env.N8N_E2E_WEBHOOK_URL;

/** Guard: returns false and sends 400 if N8N_PUBLIC_API_KEY is not configured. */
function requireN8nApiKey(res: Response): boolean {
  if (!N8N_PUBLIC_API_KEY) {
    res.status(400).json({
      success: false,
      error: { code: 'N8N_API_KEY_MISSING', message: 'N8N_PUBLIC_API_KEY is not configured.' },
    });
    return false;
  }
  return true;
}

/** Normalize n8n list payloads — handles array, { data: [] }, and { items: [] } shapes. */
function extractN8nList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p?.data)) return p.data as T[];
  if (Array.isArray(p?.items)) return p.items as T[];
  return [];
}

const MONITOR_SERVICES: ProbeService[] = [
  { key: 'api', name: 'API Gateway', url: process.env.GATEWAY_URL || 'http://localhost:3000' },
  { key: 'auth', name: 'Auth Service', url: AUTH_SERVICE_URL },
  { key: 'user', name: 'User Service', url: USER_SERVICE_URL },
  { key: 'fitness', name: 'Fitness Service', url: FITNESS_SERVICE_URL },
  { key: 'ai', name: 'AI Service', url: AI_SERVICE_URL },
  { key: 'chat', name: 'Chat Service', url: CHAT_SERVICE_URL },
  // n8n is optional — its absence should not degrade core service health score
  { key: 'n8n', name: 'n8n Workflow', url: N8N_BASE_URL, healthPath: '/healthz', optional: true },
];

function serviceUnavailable(serviceName: string) {
  return (err: Error, _req: Request, res: Response) => {
    logger.error({ error: `${serviceName} proxy error`, message: err.message });
    (res as Response).status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: `${serviceName} is unavailable`,
      },
    });
  };
}

const router = Router();

function stripAccessTokenQuery(req: Request, _res: Response, next: NextFunction) {
  const [pathname, queryString] = req.url.split('?');
  if (!queryString) {
    return next();
  }

  const params = new URLSearchParams(queryString);
  if (!params.has('access_token')) {
    return next();
  }

  params.delete('access_token');
  const nextQuery = params.toString();
  req.url = nextQuery ? `${pathname}?${nextQuery}` : pathname;
  return next();
}

// ── n8n Studio entry auth ─────────────────────────────────────────────────────
// Only the INITIAL page load (URL carries ?access_token=JWT) is gated by the
// gateway JWT + admin-role check. All subsequent sub-resource requests
// (JS/CSS/images/WebSocket and /rest/* API calls) pass straight through to n8n.
// n8n v1.97.1 manages its own session: the browser completes n8n's login flow,
// n8n sets its own session cookie, then the editor loads normally.
//
// Why not protect every sub-request with the gateway JWT?
// 1. The JWT is a one-time entry token — it's NOT a persistent session credential.
// 2. n8n v1.97.1 dropped Basic-auth; it requires its own user-management login.
// 3. Requiring JWT on assets/REST caused 401s that prevented the login page JS
//    from loading at all, creating an unbreakable chicken-and-egg loop.
function n8nEntryAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.query.access_token) {
    // Sub-resource request (asset, API call, WS) — let n8n handle auth
    return next();
  }
  // Initial page load carries ?access_token=JWT: verify JWT + admin role
  if (req.headers.authorization === undefined) {
    req.headers.authorization = `Bearer ${req.query.access_token as string}`;
  }
  return authMiddleware(req, res, () => {
    requireRoles('ADMIN')(req, res, next);
  });
}

function getN8nAxiosOptions() {
  const headers: Record<string, string> = {};
  if (N8N_PUBLIC_API_KEY) {
    headers['X-N8N-API-KEY'] = N8N_PUBLIC_API_KEY;
  }

  return {
    headers,
    timeout: 10000,
    validateStatus: () => true,
    auth:
      N8N_BASIC_AUTH_USER && N8N_BASIC_AUTH_PASSWORD
        ? {
            username: N8N_BASIC_AUTH_USER,
            password: N8N_BASIC_AUTH_PASSWORD,
          }
        : undefined,
  };
}

async function requestN8nPost(path: string, body: unknown) {
  return axios.post(buildN8nApiUrl(path), body, getN8nAxiosOptions());
}

async function requestN8nPatch(path: string, body: unknown) {
  return axios.patch(buildN8nApiUrl(path), body, getN8nAxiosOptions());
}

// Build a URL directly against n8n's base (no editor path prefix).
// N8N_EDITOR_BASE_PATH is only the path n8n uses for its own UI — it must NOT
// be prepended to API/health paths like /healthz or /api/v1/workflows.
function buildN8nApiUrl(path: string) {
  const normalizedBase = N8N_BASE_URL.endsWith('/') ? N8N_BASE_URL.slice(0, -1) : N8N_BASE_URL;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function requestN8n(path: string) {
  return axios.get(buildN8nApiUrl(path), getN8nAxiosOptions());
}

function getStudioUrls(req?: Request) {
  const editorPath = N8N_EDITOR_BASE_PATH.startsWith('/')
    ? N8N_EDITOR_BASE_PATH
    : `/${N8N_EDITOR_BASE_PATH}`;
  const studioPath = editorPath.replace(/\/+$/, '');

  const envPublicBase =
    process.env.N8N_PUBLIC_URL
    || process.env.N8N_WEBHOOK_URL
    || N8N_BASE_URL;

  const normalizedEnvBase = envPublicBase.endsWith('/')
    ? envPublicBase.slice(0, -1)
    : envPublicBase;

  let directBase = normalizedEnvBase;
  try {
    const parsed = new URL(normalizedEnvBase);
    if (parsed.hostname === 'n8n') {
      parsed.hostname = req?.hostname || 'localhost';
      directBase = parsed.toString().replace(/\/$/, '');
    }
  } catch {
    directBase = 'http://localhost:5678';
  }

  return {
    // proxied URLs (kept for compatibility)
    proxiedStudioUrl: studioPath,
    proxiedSignInUrl: `${studioPath}/login`,
    proxiedSignUpUrl: `${studioPath}/register`,
    // direct n8n UI URLs (used by frontend to avoid SPA route mismatch on proxy path)
    studioUrl: `${directBase}/`,
    signInUrl: `${directBase}/`,
    signUpUrl: `${directBase}/`,
  };
}

async function checkN8nSessionFromRequestCookie(req: Request) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return { authenticated: false, statusCode: 401 };
  }

  const response = await axios.get(buildN8nApiUrl('/rest/login'), {
    timeout: 5000,
    validateStatus: () => true,
    headers: {
      Cookie: cookieHeader,
    },
  });

  return {
    authenticated: response.status < 400,
    statusCode: response.status,
  };
}

async function probeServices(): Promise<ProbeResult[]> {
  const probes = await Promise.all(
    MONITOR_SERVICES.map(async (service) => {
      const started = Date.now();
      const healthEndpoint = service.healthPath ?? '/health';

      try {
        // Optional services (e.g. n8n) get a shorter timeout so they can't stall the dashboard.
        const response = await axios.get(`${service.url}${healthEndpoint}`, {
          timeout: service.optional ? 2000 : 5000,
          validateStatus: () => true,
        });

        const latencyMs = Date.now() - started;
        const body = response.data || {};
        // n8n /healthz returns 200 with plain text; other services return JSON { status: 'ok' | 'healthy' }
        const isHealthy =
          response.status < 400 &&
          (service.healthPath
            ? true // non-standard health path: 2xx means healthy
            : body.status === 'ok' || body.status === 'healthy');
        const uptimeSeconds = typeof body.uptime === 'number' ? body.uptime : null;

        return {
          key: service.key,
          name: service.name,
          status: isHealthy ? 'healthy' : 'degraded',
          statusCode: response.status,
          latencyMs,
          uptimeSeconds,
          timestamp: body.timestamp || new Date().toISOString(),
          error: isHealthy ? null : `Health endpoint returned status ${response.status}`,
          optional: service.optional ?? false,
        } as ProbeResult;
      } catch (error: any) {
        return {
          key: service.key,
          name: service.name,
          status: 'down',
          statusCode: 0,
          latencyMs: Date.now() - started,
          uptimeSeconds: null,
          timestamp: new Date().toISOString(),
          error: error?.message || 'Health check failed',
          optional: service.optional ?? false,
        } as ProbeResult;
      }
    }),
  );

  return probes;
}

function buildMonitorSummary(probes: ProbeResult[]) {
  const serviceCount = probes.length;
  const healthyCount = probes.filter((s) => s.status === 'healthy').length;
  const degradedCount = probes.filter((s) => s.status === 'degraded').length;
  const downCount = probes.filter((s) => s.status === 'down').length;
  // Optional services (e.g. n8n) don't count against the core health score
  const coreProbes = probes.filter((s) => !s.optional);
  const coreHealthy = coreProbes.filter((s) => s.status === 'healthy').length;
  const healthScore = coreProbes.length > 0 ? Math.round((coreHealthy / coreProbes.length) * 100) : 0;

  const recentErrors = probes
    .filter((s) => s.status !== 'healthy')
    .map((s) => ({
      level: s.status === 'down' ? 'error' : 'warning',
      service: s.name,
      message: s.error || 'Unknown issue',
      time: new Date(s.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

  return {
    serviceCount,
    healthyCount,
    degradedCount,
    downCount,
    healthScore,
    recentErrors,
  };
}

router.get('/admin/system-monitor', authMiddleware, requireRoles('ADMIN'), async (_req, res) => {
  const startAll = Date.now();
  const probes = await probeServices();
  const summary = buildMonitorSummary(probes);

  res.json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - startAll,
      summary: {
        serviceCount: summary.serviceCount,
        healthyCount: summary.healthyCount,
        degradedCount: summary.degradedCount,
        downCount: summary.downCount,
        healthScore: summary.healthScore,
      },
      services: probes,
      recentErrors: summary.recentErrors,
    },
  });
});

router.get('/admin/dashboard', authMiddleware, requireRoles('ADMIN'), async (req, res) => {
  const startAll = Date.now();

  try {
    const authHeader = req.headers.authorization;

    const [usersRes, ptsRes, probes] = await Promise.all([
      axios.get(`${AUTH_SERVICE_URL}/auth/users`, {
        headers: authHeader ? { Authorization: authHeader } : undefined,
        timeout: 6000,
      }),
      axios.get(`${USER_SERVICE_URL}/profile/pts`, {
        headers: authHeader ? { Authorization: authHeader } : undefined,
        timeout: 6000,
      }),
      probeServices(),
    ]);

    const users = ((usersRes.data?.users || []) as AuthUser[]).filter((u) => u.role !== 'ADMIN');
    const ptProfiles = (ptsRes.data?.pts || []) as PTProfile[];
    const ptSet = new Set(ptProfiles.filter((p) => p.isPT).map((p) => p.userId));

    const totalUsers = users.length;
    const verifiedPTs = users.filter((u) => u.role === 'PT' || ptSet.has(u.id)).length;
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const sessionsToday = users.filter((u) => u.updatedAt?.slice(0, 10) === todayIso).length;
    const pendingPT = users.filter((u) => u.role !== 'PT' && ptSet.has(u.id)).length;

    const sortedUsers = [...users].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const monthLabels: string[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthLabels.push(d.toLocaleString('en-US', { month: 'short' }));
    }

    const usersByMonth = new Map<string, number>();
    let cumulative = 0;
    for (const label of monthLabels) {
      usersByMonth.set(label, 0);
    }
    for (const u of sortedUsers) {
      const label = new Date(u.createdAt).toLocaleString('en-US', { month: 'short' });
      if (usersByMonth.has(label)) {
        usersByMonth.set(label, (usersByMonth.get(label) || 0) + 1);
      }
    }
    const userGrowth = monthLabels.map((label) => {
      cumulative += usersByMonth.get(label) || 0;
      return { month: label, users: cumulative };
    });

    const clientCount = users.filter((u) => u.role === 'CUSTOMER').length;
    const trainerCount = users.filter((u) => u.role === 'PT' || ptSet.has(u.id)).length;

    const monitorSummary = buildMonitorSummary(probes);
    const aiProbe = probes.find((p) => p.key === 'ai');
    const aiHealthy = aiProbe?.status === 'healthy';
    const aiBase = aiHealthy ? 48 : 22;
    const aiFail = aiHealthy ? 2 : 8;
    const ocrStats = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => ({
      day,
      success: Math.max(5, aiBase - idx * 3),
      fail: Math.max(1, aiFail - Math.floor(idx / 2)),
    }));

    const recentUsers = users
      .slice(0, 4)
      .map((u) => ({
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email.split('@')[0],
        email: u.email,
        role: u.role === 'PT' ? 'PT' : 'Client',
        joined: new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
        status: u.role === 'PT' || ptSet.has(u.id) ? 'Pending' : 'Active',
      }));

    const alerts = [
      ...monitorSummary.recentErrors,
      pendingPT > 0
        ? {
            level: 'info',
            service: 'PT Management',
            message: `${pendingPT} PT verification requests pending admin review`,
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          }
        : null,
    ].filter(Boolean);

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - startAll,
        kpis: {
          totalUsers,
          verifiedPTs,
          activeContracts: 0,
          sessionsToday,
          pendingPT,
        },
        userGrowth,
        roleData: [
          { name: 'Clients', value: clientCount },
          { name: 'Trainers', value: trainerCount },
        ],
        ocrStats,
        systemAlerts: alerts,
        recentUsers,
        monitor: {
          healthScore: monitorSummary.healthScore,
          healthyCount: monitorSummary.healthyCount,
          serviceCount: monitorSummary.serviceCount,
        },
      },
    });
  } catch (error: any) {
    logger.error({ error: error?.message, stack: error?.stack }, 'Admin dashboard aggregation failed');
    res.status(500).json({
      success: false,
      error: {
        code: 'DASHBOARD_AGGREGATION_FAILED',
        message: 'Failed to aggregate dashboard data',
      },
    });
  }
});

router.get('/admin/workflows/meta', authMiddleware, requireRoles('ADMIN'), async (_req, res) => {
  try {
    const healthResponse = await requestN8n('/healthz');
    const editorPath = N8N_EDITOR_BASE_PATH.startsWith('/')
      ? N8N_EDITOR_BASE_PATH
      : `/${N8N_EDITOR_BASE_PATH}`;

    res.json({
      success: true,
      data: {
        studioPath: `${editorPath}/`,
        apiEnabled: !!N8N_PUBLIC_API_KEY,
        status: healthResponse.status < 400 ? 'healthy' : 'degraded',
        healthStatusCode: healthResponse.status,
      },
    });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'n8n meta endpoint failed');
    res.status(502).json({
      success: false,
      error: {
        code: 'N8N_UNAVAILABLE',
        message: 'n8n is unavailable. Verify docker-compose service and env settings.',
      },
    });
  }
});

router.get('/admin/workflows/studio-auth-state', authMiddleware, requireRoles('ADMIN'), async (req, res) => {
  const urls = getStudioUrls(req);

  try {
    const [healthResponse, settingsResponse, sessionState] = await Promise.all([
      requestN8n('/healthz'),
      requestN8n('/rest/settings'),
      checkN8nSessionFromRequestCookie(req),
    ]);

    const n8nReachable = healthResponse.status < 400;
    const settingsPayload = settingsResponse.data as { data?: N8nSettingsData };
    const showSetupOnFirstLoad = !!settingsPayload?.data?.userManagement?.showSetupOnFirstLoad;
    const supportsSignUp = showSetupOnFirstLoad;
    const requiresSignIn = !showSetupOnFirstLoad && !sessionState.authenticated;

    let signUpReason: string | null = null;
    if (!supportsSignUp) {
      signUpReason = 'n8n owner has been created. Public sign-up is unavailable; use sign-in or invite-based user flow.';
    }

    res.json({
      success: true,
      data: {
        n8nReachable,
        authenticated: sessionState.authenticated,
        requiresSignIn,
        supportsSignUp,
        authMode: showSetupOnFirstLoad ? 'owner-setup' : 'sign-in',
        signUpReason,
        studioUrl: urls.studioUrl,
        signInUrl: urls.signInUrl,
        signUpUrl: urls.signUpUrl,
        proxiedStudioUrl: urls.proxiedStudioUrl,
        proxiedSignInUrl: urls.proxiedSignInUrl,
        proxiedSignUpUrl: urls.proxiedSignUpUrl,
        healthStatusCode: healthResponse.status,
        sessionProbeStatusCode: sessionState.statusCode,
      },
    });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'n8n studio-auth-state failed');
    res.status(502).json({
      success: false,
      error: {
        code: 'N8N_UNAVAILABLE',
        message: 'Cannot determine n8n auth state because n8n is unreachable.',
      },
      data: {
        n8nReachable: false,
        authenticated: false,
        requiresSignIn: true,
        supportsSignUp: false,
        authMode: 'unknown',
        signUpReason: 'n8n is unreachable.',
        studioUrl: urls.studioUrl,
        signInUrl: urls.signInUrl,
        signUpUrl: urls.signUpUrl,
        proxiedStudioUrl: urls.proxiedStudioUrl,
        proxiedSignInUrl: urls.proxiedSignInUrl,
        proxiedSignUpUrl: urls.proxiedSignUpUrl,
      },
    });
  }
});

router.get('/admin/workflows', authMiddleware, requireRoles('ADMIN'), async (_req, res) => {
  if (!requireN8nApiKey(res)) return;

  try {
    const workflowResponse = await requestN8n('/api/v1/workflows');

    if (workflowResponse.status >= 400) {
      res.status(502).json({
        success: false,
        error: { code: 'N8N_API_ERROR', message: `Unable to fetch workflows from n8n (status ${workflowResponse.status})` },
      });
      return;
    }

    const workflows = extractN8nList<N8nWorkflow>(workflowResponse.data);

    res.json({
      success: true,
      data: {
        total: workflows.length,
        active: workflows.filter((w) => w.active).length,
        inactive: workflows.filter((w) => !w.active).length,
        workflows,
      },
    });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'n8n workflow fetch failed');
    res.status(502).json({ success: false, error: { code: 'N8N_UNAVAILABLE', message: 'Cannot reach n8n workflow API.' } });
  }
});

// Protected — n8n execution list for a specific workflow
router.get('/admin/workflows/:workflowId/executions', authMiddleware, requireRoles('ADMIN'), async (req, res) => {
  if (!requireN8nApiKey(res)) return;

  const { workflowId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    const response = await requestN8n(
      `/api/v1/executions?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}&includeData=false`,
    );

    if (response.status >= 400) {
      res.status(502).json({
        success: false,
        error: { code: 'N8N_API_ERROR', message: `n8n returned status ${response.status}` },
      });
      return;
    }

    const executions = extractN8nList<N8nExecution>(response.data);
    const nextCursor = (response.data as Record<string, unknown>)?.nextCursor ?? null;

    res.json({
      success: true,
      data: { workflowId, total: executions.length, nextCursor, executions },
    });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'n8n execution list failed');
    res.status(502).json({ success: false, error: { code: 'N8N_UNAVAILABLE', message: 'Cannot reach n8n execution API.' } });
  }
});

// Protected — n8n execution detail
router.get('/admin/workflows/executions/:executionId', authMiddleware, requireRoles('ADMIN'), async (req, res) => {
  if (!requireN8nApiKey(res)) return;

  const { executionId } = req.params;

  try {
    const response = await requestN8n(`/api/v1/executions/${encodeURIComponent(executionId)}?includeData=false`);

    if (response.status === 404) {
      res.status(404).json({
        success: false,
        error: { code: 'EXECUTION_NOT_FOUND', message: `Execution ${executionId} not found.` },
      });
      return;
    }

    if (response.status >= 400) {
      res.status(502).json({
        success: false,
        error: { code: 'N8N_API_ERROR', message: `n8n returned status ${response.status}` },
      });
      return;
    }

    const execution = response.data as N8nExecution;

    res.json({ success: true, data: { execution } });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'n8n execution detail failed');
    res.status(502).json({
      success: false,
      error: { code: 'N8N_UNAVAILABLE', message: 'Cannot reach n8n execution API.' },
    });
  }
});

// Protected — n8n smoke test: triggers webhook and returns result
router.post('/admin/workflows/smoke-test', authMiddleware, requireRoles('ADMIN'), async (_req, res) => {
  if (!N8N_SMOKE_TEST_WEBHOOK_URL) {
    res.status(400).json({
      success: false,
      error: {
        code: 'SMOKE_TEST_NOT_CONFIGURED',
        message:
          'N8N_SMOKE_TEST_WEBHOOK_URL is not set. ' +
          'Import infra/n8n/workflows/smoke-test-ping.json into n8n, activate it, ' +
          'then set N8N_SMOKE_TEST_WEBHOOK_URL=http://n8n:5678/webhook/gym-smoke-test in gateway env.',
      },
    });
    return;
  }

  const startedAt = Date.now();

  try {
    const response = await axios.post(
      N8N_SMOKE_TEST_WEBHOOK_URL,
      { source: 'admin-smoke-test', timestamp: new Date().toISOString() },
      { timeout: 15000, validateStatus: () => true },
    );

    const durationMs = Date.now() - startedAt;
    const passed = response.status >= 200 && response.status < 300;

    res.json({
      success: true,
      data: {
        passed,
        statusCode: response.status,
        durationMs,
        responseBody: response.data,
        testedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;
    logger.error({ error: error?.message }, 'n8n smoke test failed');
    res.status(502).json({
      success: false,
      error: {
        code: 'SMOKE_TEST_FAILED',
        message: error?.message || 'Smoke test request failed — n8n may be down or webhook inactive.',
        durationMs,
        testedAt: new Date().toISOString(),
      },
    });
  }
});

// Protected — full E2E system test via n8n orchestrator workflow
router.post('/admin/workflows/full-system-test', authMiddleware, requireRoles('ADMIN'), async (_req, res) => {
  if (!N8N_E2E_WEBHOOK_URL) {
    res.status(400).json({
      success: false,
      error: {
        code: 'E2E_TEST_NOT_CONFIGURED',
        message:
          'N8N_E2E_WEBHOOK_URL is not set. ' +
          'Import and activate infra/n8n/workflows/01-05 sub-workflows, then 06-gym-e2e-orchestrator.json, ' +
          'then set N8N_E2E_WEBHOOK_URL=http://n8n:5678/webhook/gym-e2e-run in gateway env.',
      },
    });
    return;
  }

  const startedAt = Date.now();

  try {
    const response = await axios.post(
      N8N_E2E_WEBHOOK_URL,
      { source: 'admin-e2e-test', timestamp: new Date().toISOString() },
      { timeout: 90000, validateStatus: () => true },
    );

    const durationMs = Date.now() - startedAt;

    if (response.status >= 400) {
      res.status(502).json({
        success: false,
        error: {
          code: 'E2E_TEST_FAILED',
          message: `Orchestrator returned HTTP ${response.status}`,
          durationMs,
          testedAt: new Date().toISOString(),
        },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        ...response.data,
        durationMs,
        testedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;
    logger.error({ error: error?.message }, 'n8n full-system-test failed');
    res.status(502).json({
      success: false,
      error: {
        code: 'E2E_TEST_FAILED',
        message: error?.message || 'E2E test request failed — n8n may be down or orchestrator webhook inactive.',
        durationMs,
        testedAt: new Date().toISOString(),
      },
    });
  }
});

// Protected — create sample workflows in n8n via API (idempotent: skips if name already exists)
router.post('/admin/workflows/setup-samples', authMiddleware, requireRoles('ADMIN'), async (_req, res) => {
  if (!requireN8nApiKey(res)) return;

  // Workflow definition — _meta is internal, strip it before sending to n8n
  const smokeTestDef = {
    name: 'Gym Coach - Smoke Test',
    nodes: [
      {
        parameters: { httpMethod: 'POST', path: 'gym-smoke-test', responseMode: 'responseNode', options: {} },
        id: 'a1b2c3d4-0001-0001-0001-000000000001',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [240, 300],
        webhookId: 'gym-smoke-test',
      },
      {
        parameters: {
          method: 'GET',
          url: 'http://api-gateway:3000/health',
          options: { timeout: 5000, response: { response: { neverError: true } } },
        },
        id: 'a1b2c3d4-0002-0002-0002-000000000002',
        name: 'Ping Gateway',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [460, 300],
      },
      {
        parameters: {
          options: {},
          respondWith: 'json',
          responseBody:
            "={{ JSON.stringify({ smokeTestPassed: true, gateway: $json, source: $('Webhook').item.json.body?.source ?? 'unknown', timestamp: new Date().toISOString() }) }}",
        },
        id: 'a1b2c3d4-0003-0003-0003-000000000003',
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1,
        position: [680, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Ping Gateway', type: 'main', index: 0 }]] },
      'Ping Gateway': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', timezone: 'Asia/Ho_Chi_Minh' },
  };

  try {
    // Check if workflow already exists to keep this idempotent
    const listRes = await requestN8n('/api/v1/workflows');
    const existing = extractN8nList<N8nWorkflow>(listRes.data);
    const alreadyExists = existing.find((w) => w.name === smokeTestDef.name);

    if (alreadyExists) {
      res.json({
        success: true,
        data: {
          created: false,
          activated: alreadyExists.active,
          workflow: alreadyExists,
          message: `Workflow "${smokeTestDef.name}" already exists (id: ${alreadyExists.id}).`,
        },
      });
      return;
    }

    // Create workflow
    const createRes = await requestN8nPost('/api/v1/workflows', smokeTestDef);
    if (createRes.status >= 400) {
      res.status(502).json({
        success: false,
        error: { code: 'N8N_CREATE_FAILED', message: `n8n returned ${createRes.status} when creating workflow.` },
      });
      return;
    }

    const created = createRes.data as N8nWorkflow;

    // Activate workflow
    const activateRes = await requestN8nPatch(`/api/v1/workflows/${created.id}/activate`, {});
    const activated = activateRes.status < 400;

    res.json({
      success: true,
      data: {
        created: true,
        activated,
        workflow: created,
        message: activated
          ? `Workflow "${created.name}" created and activated. Webhook: /webhook/gym-smoke-test`
          : `Workflow "${created.name}" created but activation failed — activate manually in n8n Studio.`,
      },
    });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'n8n setup-samples failed');
    res.status(502).json({
      success: false,
      error: { code: 'N8N_UNAVAILABLE', message: error?.message || 'Cannot reach n8n API.' },
    });
  }
});

// Protected — n8n Studio embed (admin only, cookie-based session)
// The initial page load carries ?access_token=JWT. After verification a session
// Only the initial page load (carries ?access_token=JWT) is gated.
// Sub-resource requests pass straight through — n8n handles its own session.
router.get('/admin/workflows/studio/login', (req, res) => {
  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  res.redirect(302, `/admin/workflows/studio${query}`);
});

router.get('/admin/workflows/studio/register', (req, res) => {
  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  res.redirect(302, `/admin/workflows/studio${query}`);
});

router.use(
  '/admin/workflows/studio',
  n8nEntryAuth,
  stripAccessTokenQuery,
  createProxyMiddleware({
    target: N8N_BASE_URL,
    changeOrigin: true,
    ws: true,
    // Express strips the /admin/workflows/studio mount point before the proxy sees
    // the path. Re-add the full base path so n8n (built with N8N_PATH matching
    // this prefix) can locate every asset: HTML, JS, CSS, images.
    pathRewrite: (path) => {
      const base = N8N_EDITOR_BASE_PATH.endsWith('/')
        ? N8N_EDITOR_BASE_PATH.slice(0, -1)
        : N8N_EDITOR_BASE_PATH;

      let rewritten = path || '/';
      if (rewritten.startsWith(base)) {
        rewritten = rewritten.slice(base.length) || '/';
      }

      if (!rewritten.startsWith('/')) {
        rewritten = `/${rewritten}`;
      }

      // n8n latest serves auth screens from SPA shell at '/'.
      // Keep compatibility for links like '/signin', '/login', '/signup', '/register'.
      if (
        rewritten.startsWith('/signin')
        || rewritten.startsWith('/login')
        || rewritten.startsWith('/signup')
        || rewritten.startsWith('/register')
      ) {
        const queryIndex = rewritten.indexOf('?');
        rewritten = queryIndex >= 0 ? `/${rewritten.slice(queryIndex)}` : '/';
      }

      return rewritten;
    },
    onProxyRes: (proxyRes) => {
      // Remove frame / CSP guards so the admin UI can host n8n and
      // n8n's inline scripts are not blocked by Helmet defaults.
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['x-content-type-options'];

      // Rewrite absolute Location headers so browser stays on the gateway origin.
      const location = proxyRes.headers['location'];
      if (typeof location === 'string' && location.startsWith(N8N_BASE_URL)) {
        proxyRes.headers['location'] = location.replace(N8N_BASE_URL, '');
      }

      proxyRes.headers['set-cookie'] = normalizeSetCookiePath(proxyRes.headers['set-cookie']);
    },
    onError: serviceUnavailable('n8n studio'),
  }),
);

// n8n REST sub-resources (/rest/settings, /rest/workflows, /rest/sentry.js …)
// No gateway auth here — n8n v1.97.1 uses its own user-management session.
// Express strips the '/rest' mount point, so pathRewrite adds it back.
router.use(
  '/rest',
  createProxyMiddleware({
    target: N8N_BASE_URL,
    changeOrigin: true,
    pathRewrite: (path) => (path.startsWith('/rest') ? path : `/rest${path}`),
    onProxyRes: (proxyRes) => {
      proxyRes.headers['set-cookie'] = normalizeSetCookiePath(proxyRes.headers['set-cookie']);
    },
    onError: serviceUnavailable('n8n rest'),
  }),
);

// n8n static assets used by studio (e.g. /assets/index-*.js, /assets/polyfills-*.js)
router.use(
  '/assets',
  createProxyMiddleware({
    target: N8N_BASE_URL,
    changeOrigin: true,
    onProxyRes: (proxyRes) => {
      proxyRes.headers['set-cookie'] = normalizeSetCookiePath(proxyRes.headers['set-cookie']);
    },
    onError: serviceUnavailable('n8n assets'),
  }),
);

// n8n signin page and related auth entrypoint
router.use(
  '/signin',
  createProxyMiddleware({
    target: N8N_BASE_URL,
    changeOrigin: true,
    pathRewrite: () => '/',
    onProxyRes: (proxyRes) => {
      proxyRes.headers['set-cookie'] = normalizeSetCookiePath(proxyRes.headers['set-cookie']);
    },
    onError: serviceUnavailable('n8n signin'),
  }),
);

router.use(
  '/login',
  createProxyMiddleware({
    target: N8N_BASE_URL,
    changeOrigin: true,
    pathRewrite: () => '/',
    onProxyRes: (proxyRes) => {
      proxyRes.headers['set-cookie'] = normalizeSetCookiePath(proxyRes.headers['set-cookie']);
    },
    onError: serviceUnavailable('n8n login'),
  }),
);

// n8n static resources used by signin and shell boot scripts
router.use(
  '/static',
  createProxyMiddleware({
    target: N8N_BASE_URL,
    changeOrigin: true,
    onProxyRes: (proxyRes) => {
      proxyRes.headers['set-cookie'] = normalizeSetCookiePath(proxyRes.headers['set-cookie']);
    },
    onError: serviceUnavailable('n8n static'),
  }),
);

// Protected — Auth role management (admin only)
router.use(
  '/auth/users/:userId/role',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Auth service'),
  }),
);

// Protected — Auth user management (admin only)
router.use(
  '/auth/users',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Auth service'),
  }),
);

// Public — Auth Service
router.use(
  '/auth',
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Auth service'),
  }),
);

// Protected — PT registration (only customer/admin can trigger)
router.use(
  '/profile/me/become-pt',
  authMiddleware,
  requireRoles('CUSTOMER', 'ADMIN'),
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/profile': '/profile' },
    onError: serviceUnavailable('User service'),
  }),
);

// Protected — User Service
router.use(
  '/profile',
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/profile': '/profile' },
    onError: serviceUnavailable('User service'),
  }),
);

// Protected — Fitness Service (workouts)
router.use(
  '/workouts',
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (nutrition)
router.use(
  '/nutrition',
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (stats)
router.use(
  '/stats',
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Public — Exercises (no auth needed to browse)
router.use(
  '/exercises',
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Plans (AI Service)
router.use(
  '/plans',
  authMiddleware,
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('AI service'),
  }),
);

// Protected — AI Service
router.use(
  '/ai',
  authMiddleware,
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      const userId = req.headers['x-user-id'];
      const userEmail = req.headers['x-user-email'];
      const userRole = req.headers['x-user-role'];
      const authorization = req.headers.authorization;

      if (typeof userId === 'string') proxyReq.setHeader('x-user-id', userId);
      if (typeof userEmail === 'string')
        proxyReq.setHeader('x-user-email', userEmail);
      if (typeof userRole === 'string')
        proxyReq.setHeader('x-user-role', userRole);
      if (typeof authorization === 'string') {
        proxyReq.setHeader('Authorization', authorization);
      }
    },
    onError: serviceUnavailable('AI service'),
  }),
);

// Protected — Chat Service (REST only; Socket.IO connects directly to :3005)
router.use(
  '/chat',
  authMiddleware,
  createProxyMiddleware({
    target: CHAT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Chat service'),
  }),
);

// Protected — InBody (User Service)
router.use(
  '/inbody',
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/inbody': '/inbody' },
    // OCR image extraction can run for tens of seconds.
    timeout: 180000,
    proxyTimeout: 180000,
    onError: serviceUnavailable('User service'),
  }),
);

// Protected — PT Applications (User Service)
router.use(
  '/pt-applications',
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/pt-applications': '/pt-applications' },
    onError: serviceUnavailable('User service'),
  }),
);

// Public — Uploads (User Service)
router.use(
  '/uploads',
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('User service (Uploads)'),
  }),
);

export default router;
