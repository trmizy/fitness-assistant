/**
 * Test-mode OUTBOUND guard (Slice 2 safety round). Installed by the preload (db-isolation.ts) BEFORE any service module is imported, so no HTTP / fetch /
 * socket call a test makes can reach the dev stack, a real payment gateway, a mail / push provider, redis, minio or any other host.
 *
 * What is allowed: a connection to loopback, to a host:port that a test REGISTERED on purpose as a test service (registerTestService(url), or the env list
 * TEST_ALLOWED_SERVICE_URLS), and any unix-socket / named-pipe path (the test runner's own IPC).
 * What is ALWAYS refused, even when registered: the dev ports (3000-3010 = gateway + services, 5432 / 5433 = dev postgres, 6379 = redis, 9000 / 9001 = minio)
 * and every non-loopback host. A refusal throws / rejects with code OUTBOUND_BLOCKED_IN_TEST and opens NO socket.
 *
 * Layers (all share ONE state object on globalThis, so the preload copy and a test's import see the same registry):
 *   1. globalThis.fetch              - checked before the original runs (undici is never reached for a blocked URL);
 *   2. http.request / http.get / https.request / https.get - checked synchronously, before a ClientRequest exists. axios (every instance, axios.create included:
 *      its node adapter calls http/https through follow-redirects) and any client using http directly go through here;
 *   3. net.Socket.prototype.connect  - the last line: whatever opens a TCP socket (ioredis, nodemailer, tls.connect, undici) is refused here.
 * Prisma's query engine is native code and cannot be intercepted from JS: the database is protected by the URL validator instead (db-isolation.ts).
 *
 * Default URLs in the product code (`process.env.X_URL || "http://localhost:3007"`): the preload sets every service-URL / endpoint variable that is not
 * set to SENTINEL_URL, so those defaults are never used; SENTINEL_URL is loopback port 9 and is never registered, so a client that uses it is refused with
 * a message that names this file.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const SENTINEL_URL = "http://127.0.0.1:9";
export const BLOCKED_PORTS: readonly number[] = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 5432, 5433, 6379, 9000, 9001];
/** The isolated test postgres (docker-compose.test.yml). Tests of this repo may open JS-level connections to it (a `pg` client in a test); WHICH database is decided by the URL validator, never here. 5432 / 5433 (dev) stay blocked. */
export const TEST_POSTGRES_PORT = 55433;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

interface GuardState {
  allowed: Set<string>;
  blocked: Array<{ via: string; target: string; reason: string }>;
  allowedLog: string[];
  installed: boolean;
  /** TEST SEAM: replaces the real Socket.prototype.connect so a test can prove the underlying connect was never called for a blocked target. */
  underlyingConnect?: (this: net.Socket, ...args: any[]) => any;
}
const KEY = "__GYMINI_TEST_OUTBOUND__";
function state(): GuardState {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = { allowed: new Set<string>(), blocked: [], allowedLog: [], installed: false } as GuardState;
  return g[KEY];
}

export class OutboundBlockedError extends Error {
  code = "OUTBOUND_BLOCKED_IN_TEST";
  constructor(target: string, reason: string) {
    super(`OUTBOUND_BLOCKED_IN_TEST: ${target} - ${reason}. Register a test service you started yourself with registerTestService(url) (src/__tests__/setup/outbound-guard.ts) or TEST_ALLOWED_SERVICE_URLS.`);
    this.name = "OutboundBlockedError";
  }
}

const normHost = (h: string) => {
  const x = h.toLowerCase().replace(/^\[|\]$/g, "");
  return x === "localhost" || x === "::1" || x === "127.0.0.1" ? "loopback" : x;
};
const keyOf = (host: string, port: number) => `${normHost(host)}:${port}`;

function envAllowed(): string[] {
  return (process.env.TEST_ALLOWED_SERVICE_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function portOf(u: URL): number {
  return Number(u.port || (u.protocol === "https:" || u.protocol === "wss:" ? 443 : 80));
}

/** Registers a test service (one you started in this process or as a child) as reachable. Dev ports and non-loopback hosts stay refused. */
export function registerTestService(url: string): void {
  const u = new URL(url);
  const port = portOf(u);
  if (!LOOPBACK.has(u.hostname.toLowerCase().replace(/^\[|\]$/g, "")) && u.hostname !== "::1") throw new Error(`registerTestService: ${url} is not a loopback host`);
  if (BLOCKED_PORTS.includes(port)) throw new Error(`registerTestService: port ${port} is a dev-stack port and can never be registered`);
  state().allowed.add(keyOf(u.hostname, port));
}
export const registeredTestServices = (): string[] => [...state().allowed, ...envAllowed().map((x) => { try { const u = new URL(x); return keyOf(u.hostname, portOf(u)); } catch { return x; } })];
export const blockedAttempts = () => state().blocked.slice();
export const allowedAttempts = () => state().allowedLog.slice();

/** The decision, pure (no I/O). null = allowed. */
export function checkOutbound(host: string, port: number): string | null {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOOPBACK.has(h)) return "host is not loopback";
  if (BLOCKED_PORTS.includes(port)) return `port ${port} is a dev-stack port (3000-3010, 5432, 5433, 6379, 9000, 9001), refused even when registered`;
  if (port === TEST_POSTGRES_PORT) return null; // the isolated test postgres (see TEST_POSTGRES_PORT)
  const reg = new Set<string>(state().allowed);
  for (const x of envAllowed()) {
    try {
      const u = new URL(x);
      reg.add(keyOf(u.hostname, portOf(u)));
    } catch {
      /* ignore junk */
    }
  }
  if (!reg.has(keyOf(h, port))) return "not a registered test service";
  return null;
}

function refuse(via: string, host: string, port: number, reason: string): never {
  const target = `${host}:${port}`;
  state().blocked.push({ via, target, reason });
  throw new OutboundBlockedError(target, reason);
}
function checkUrl(via: string, input: unknown): void {
  let u: URL;
  try {
    u = input instanceof URL ? input : new URL(typeof input === "string" ? input : (input as any)?.url ?? String(input));
  } catch {
    return; // relative / junk: the underlying call fails by itself; no socket can be opened to a host we cannot name
  }
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "ws:" && u.protocol !== "wss:") return;
  const port = portOf(u);
  const why = checkOutbound(u.hostname, port);
  if (why) refuse(via, u.hostname, port, why);
  state().allowedLog.push(`${via} ${u.hostname}:${port}`);
}
function checkRequestArgs(via: string, protocol: "http:" | "https:", args: any[]): void {
  const a0 = args[0];
  if (typeof a0 === "string" || a0 instanceof URL) return checkUrl(via, a0);
  const o = (args[1] && typeof args[1] === "object" ? { ...a0, ...args[1] } : a0) ?? {};
  if (o.socketPath) return;
  const host = String(o.hostname ?? o.host ?? "localhost").replace(/:\d+$/, "");
  const port = Number(o.port || (protocol === "https:" ? 443 : 80));
  const why = checkOutbound(host, port);
  if (why) refuse(via, host, port, why);
  state().allowedLog.push(`${via} ${host}:${port}`);
}

export function installOutboundGuard(): void {
  const s = state();
  if (s.installed) return;
  s.installed = true;

  // 1. fetch
  const realFetch = globalThis.fetch;
  if (typeof realFetch === "function") {
    globalThis.fetch = function guardedFetch(input: any, init?: any) {
      try {
        checkUrl("fetch", typeof input === "string" || input instanceof URL ? input : input?.url);
      } catch (e) {
        return Promise.reject(e);
      }
      return realFetch.call(globalThis, input, init);
    } as typeof fetch;
  }

  // 2. http / https
  for (const [mod, proto] of [[http, "http:"], [https, "https:"]] as const) {
    const realRequest = mod.request;
    const realGet = mod.get;
    (mod as any).request = function guardedRequest(...args: any[]) {
      checkRequestArgs(`${proto}request`, proto, args);
      return (realRequest as any).apply(mod, args);
    };
    (mod as any).get = function guardedGet(...args: any[]) {
      checkRequestArgs(`${proto}get`, proto, args);
      return (realGet as any).apply(mod, args);
    };
  }

  autoRegisterOwnListeners();

  // 3. every TCP socket
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: any[]) {
    let a: any = args[0];
    if (Array.isArray(a)) a = a[0]; // node passes normalised [options, cb]
    let host: string | undefined;
    let port: number | undefined;
    if (a && typeof a === "object") {
      if (a.path) return (state().underlyingConnect ?? realConnect).apply(this, args as any);
      host = a.host ?? "localhost";
      port = Number(a.port);
    } else if (typeof a === "string" && Number.isNaN(Number(a))) {
      return (state().underlyingConnect ?? realConnect).apply(this, args as any); // pipe / unix path
    } else {
      port = Number(a);
      host = typeof args[1] === "string" ? args[1] : "localhost";
    }
    const why = checkOutbound(String(host), Number(port));
    if (why) {
      const err = new OutboundBlockedError(`${host}:${port}`, why);
      s.blocked.push({ via: "net.connect", target: `${host}:${port}`, reason: why });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    s.allowedLog.push(`net ${host}:${port}`);
    return (state().underlyingConnect ?? realConnect).apply(this, args as any);
  } as typeof net.Socket.prototype.connect;
}

/**
 * A server THIS process starts on loopback (an Express app on app.listen(0), a fake auth-service, ...) is a test fixture by definition, so its port is
 * registered when it starts listening (never a dev port). Servers in OTHER processes (the payment-service child, a gym-service child) must be registered
 * explicitly with registerTestService(url) by the test that spawns them.
 */
function autoRegisterOwnListeners(): void {
  const realListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function guardedListen(this: net.Server, ...args: any[]) {
    const register = () => {
      const a = this.address();
      if (a && typeof a === "object" && !BLOCKED_PORTS.includes(a.port)) state().allowed.add(keyOf("127.0.0.1", a.port));
    };
    this.once("listening", register);
    const out = (realListen as any).apply(this, args);
    register(); // a test often reads server.address() and calls it in the same tick, before the "listening" event: register as soon as the port is bound
    return out;
  } as typeof net.Server.prototype.listen;
}

/** TEST SEAM (outbound-guard test only): swap the connect the guard finally delegates to. */
export function __setUnderlyingConnect(fn: GuardState["underlyingConnect"]): void {
  state().underlyingConnect = fn;
}

const URL_VAR = /(_URL|_ENDPOINT)$/;
/** Env variables that are NOT outbound targets even though they end in _URL. */
const NOT_OUTBOUND = /^(DATABASE_URL|CHAT_DATABASE_URL|TEST_DATABASE_URL|AUTH_TEST_DATABASE_URL|E2E_PAYMENT_DATABASE_URL|USER_DATABASE_URL|PAYMENT_DATABASE_URL|CHAT_TEST_DATABASE_URL)$|DATABASE_URL$/;
/** Outbound-target variables the product code reads (inventory in setup/README.md). Any of them left unset gets the sentinel. */
export const OUTBOUND_URL_VARS: readonly string[] = [
  "AUTH_SERVICE_URL", "USER_SERVICE_URL", "CHAT_SERVICE_URL", "GYM_SERVICE_URL", "PAYMENT_SERVICE_URL", "AI_SERVICE_URL", "FITNESS_SERVICE_URL",
  "OLLAMA_BASE_URL", "LLM_BASE_URL", "INBODY_VISION_OLLAMA_BASE_URL", "TURN_URL",
  "PT_MEDIA_S3_ENDPOINT", "PT_MEDIA_S3_PUBLIC_ENDPOINT", "PARTNER_S3_ENDPOINT", "PARTNER_S3_PUBLIC_ENDPOINT",
];

/** Sets every outbound URL variable that is not set to the sentinel, and clears the lambda-invoke switches (an AWS call is never a test dependency). */
export function neutraliseOutboundEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const touched: string[] = [];
  for (const name of OUTBOUND_URL_VARS) {
    if (!env[name]) {
      env[name] = SENTINEL_URL;
      touched.push(name);
    }
  }
  for (const name of Object.keys(env)) {
    if (URL_VAR.test(name) && !NOT_OUTBOUND.test(name) && !env[name]) env[name] = SENTINEL_URL;
    if (/_LAMBDA_NAME$/.test(name)) env[name] = "";
  }
  return touched;
}
