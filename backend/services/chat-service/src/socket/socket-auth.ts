import type { Socket } from "socket.io";
import { logger } from "@gym-coach/shared";
import { verifyToken as defaultVerifyToken } from "../clients/auth-service.client";

/**
 * Per-socket access-token holder (CALL-01).
 *
 * A socket authenticates once, at the handshake, with the access token the client had then (~15 min life). The call
 * path forwards that token to user-service (check-relationship / sessions) which verifies it again on every
 * call — so a socket older than ~15 min made every chat call fail with "Session expired" even though the user was
 * logged in (the client refreshed its token over REST but the socket never saw the new one).
 *
 * The token is now MUTABLE and refreshed two ways, both re-verified by auth-service:
 *  - push: the client emits `auth:refresh` {token} after each /auth/refresh (and after a reconnect-less resume);
 *  - pull: when a call needs the token and it is (about to be) expired, the server asks the client for a fresh one
 *    with `auth:request_token` (ack carries {token}); and the same pull runs when the token expires, so a socket
 *    cannot outlive its session unnoticed.
 *
 * Security: a token auth-service refuses (expired, user gone, account locked, SESSION_REPLACED) DISCONNECTS the
 * socket; a token of another user is refused and disconnects too. Auth-service being unreachable keeps the socket
 * (it is not a verdict) but the stale token is never used for a call. A client that does not answer the pull
 * (an older build) is left connected on its old token for chat, exactly as before; calls then still say "expired".
 */

export const TOKEN_SAFETY_MS = 20_000;
export const PULL_TIMEOUT_MS = Number(process.env.SOCKET_TOKEN_PULL_TIMEOUT_MS) || 8_000;

type VerifyFn = (token: string) => Promise<any>;

export interface SocketAuthDeps {
  verify?: VerifyFn;
  now?: () => number;
  pullTimeoutMs?: number;
  /** Wait before cutting a refused socket, so the `auth:refresh` ack carrying the reason still reaches it. */
  disconnectDelayMs?: number;
}

/** `exp` of a JWT in ms, without verifying (the caller verified it). null when unreadable. */
export function tokenExpiryMs(token: string | null | undefined): number | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json?.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function statusOf(err: unknown): number | undefined {
  const status = Number((err as any)?.response?.status ?? (err as any)?.status ?? (err as any)?.statusCode);
  return Number.isFinite(status) ? status : undefined;
}

/** The auth-service verdict on a token: 4xx = the token (or account) is refused. Anything else is not a verdict. */
function isRefusal(err: unknown): boolean {
  const status = statusOf(err);
  return typeof status === "number" && status >= 400 && status < 500;
}

export type RefreshResult = { ok: true } | { ok: false; fatal: boolean; reason: string };

export class SocketAuth {
  private token: string;
  private expiresAt: number | null;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<RefreshResult> | null = null;
  private closed = false;
  private readonly verify: VerifyFn;
  private readonly now: () => number;
  private readonly pullTimeoutMs: number;
  private readonly disconnectDelayMs: number;

  constructor(
    private readonly socket: Pick<Socket, "emit" | "disconnect"> & Partial<Pick<Socket, "timeout" | "id">>,
    private readonly userId: string,
    initialToken: string,
    deps: SocketAuthDeps = {},
  ) {
    this.token = initialToken;
    this.verify = deps.verify ?? defaultVerifyToken;
    this.now = deps.now ?? Date.now;
    this.pullTimeoutMs = deps.pullTimeoutMs ?? PULL_TIMEOUT_MS;
    this.disconnectDelayMs = deps.disconnectDelayMs ?? 50;
    this.expiresAt = tokenExpiryMs(initialToken);
    this.schedule();
  }

  /** The token currently held (may be expired — use ensureFresh() before relying on it). */
  current(): string {
    return this.token;
  }

  private isStale(): boolean {
    return this.expiresAt !== null && this.expiresAt - this.now() <= TOKEN_SAFETY_MS;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.closed || this.expiresAt === null) return;
    const wait = Math.max(this.expiresAt - this.now(), 1_000);
    // setTimeout cannot hold more than 2^31-1 ms.
    this.timer = setTimeout(() => void this.onExpiry(), Math.min(wait, 2_000_000_000));
    this.timer.unref?.();
  }

  private async onExpiry() {
    if (this.closed) return;
    const result = await this.pull();
    if (result.ok || result.fatal || this.closed) return;
    // No answer (an older client) or auth-service unreachable: not a verdict. Keep the socket and look again
    // later without a hot loop (the token stays stale, so a call still asks again by itself).
    this.timer = setTimeout(() => void this.onExpiry(), result.reason === "no-answer" ? 300_000 : 30_000);
    this.timer.unref?.();
  }

  /** Stops the expiry timer (socket gone). */
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Verifies `token` against auth-service and, when it is this socket's own user's, adopts it. */
  async adopt(token: unknown): Promise<RefreshResult> {
    if (typeof token !== "string" || !token) return { ok: false, fatal: false, reason: "bad-token" };
    let data: any;
    try {
      data = await this.verify(token);
    } catch (err) {
      if (isRefusal(err)) return this.fail(true, "refused");
      logger.warn({ userId: this.userId }, "auth:refresh — auth-service could not verify the token right now");
      return { ok: false, fatal: false, reason: "unavailable" };
    }
    if (!data?.user?.id) return this.fail(true, "refused");
    if (data.user.id !== this.userId) return this.fail(true, "user-mismatch");
    const exp = tokenExpiryMs(token);
    // Never move backwards to an older token.
    if (exp !== null && this.expiresAt !== null && exp < this.expiresAt) return { ok: true };
    this.token = token;
    this.expiresAt = exp;
    this.schedule();
    return { ok: true };
  }

  private fail(fatal: boolean, reason: string): RefreshResult {
    if (fatal && !this.closed) {
      logger.info({ userId: this.userId, socketId: this.socket.id, reason }, "Socket token refused — disconnecting");
      if (this.disconnectDelayMs <= 0) this.socket.disconnect(true);
      else setTimeout(() => this.socket.disconnect(true), this.disconnectDelayMs).unref?.();
    }
    return { ok: false, fatal, reason };
  }

  /** Asks the client for a fresh token (`auth:request_token`) and adopts it. Concurrent calls share one ask. */
  pull(): Promise<RefreshResult> {
    if (this.inflight) return this.inflight;
    const run = new Promise<RefreshResult>((resolve) => {
      if (typeof this.socket.timeout !== "function") return resolve({ ok: false, fatal: false, reason: "no-answer" });
      this.socket.timeout(this.pullTimeoutMs).emit("auth:request_token", (err: unknown, res?: { token?: string }) => {
        if (err || !res?.token) return resolve({ ok: false, fatal: false, reason: "no-answer" });
        this.adopt(res.token).then(resolve, () => resolve({ ok: false, fatal: false, reason: "unavailable" }));
      });
    }).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  /** A token that is good for the next few seconds, or null when none could be obtained. */
  async ensureFresh(): Promise<string | null> {
    if (!this.isStale()) return this.token;
    await this.pull();
    return this.isStale() ? null : this.token;
  }
}

/**
 * Registers the client-pushed `auth:refresh` event. Ack: {ok:true} | {ok:false, code}. A refused token (incl. a
 * replaced session) disconnects the socket (SocketAuth.adopt).
 */
export function registerAuthRefreshHandler(
  socket: Pick<Socket, "on">,
  auth: SocketAuth,
) {
  socket.on("auth:refresh", async (payload: { token?: string } | undefined, ack?: (r: unknown) => void) => {
    const result = await auth.adopt(payload?.token);
    if (typeof ack === "function") ack(result.ok ? { ok: true } : { ok: false, code: result.reason });
  });
}
