import net from "node:net";
import type { Request, Response, NextFunction } from "express";
import { isAcceptedServiceSecret } from "./serviceSecret.middleware";

/**
 * The client's IP address, for the audit trail (auditMeta in services/audit.service.ts).
 *
 * user-service has no `trust proxy`, so `req.ip` is the socket peer - the API gateway's address on every request. The gateway
 * proxies with http-proxy-middleware and no `xfwd`, so it forwards the incoming X-Forwarded-For UNCHANGED and does not append the
 * address of its own peer. With the gateway behind ONE trusted front proxy (the same assumption as the gateway's own
 * `app.set("trust proxy", 1)`), the rightmost entry of that header is the address that proxy saw: the client.
 *
 * The gateway now stamps the address itself: it computes the client IP with its own `trust proxy` setting (`req.ip`), deletes any
 * client-supplied `x-client-ip` and sets `x-client-ip` on every proxied request (gateway/src/app.ts). On a request that carries the
 * gateway secret a valid `x-client-ip` WINS over everything below; the X-Forwarded-For arithmetic is only the fallback for a gateway that
 * does not stamp it yet (older deploy) or a stamp that is not a valid IP.
 *
 * What is trusted, and what is not:
 *   - `x-client-ip` and X-Forwarded-For are read ONLY when the request carries the gateway's shared secret (`x-gateway-secret`, stamped by the gateway
 *     on every request after deleting any client-supplied copy). A caller that reaches user-service directly, or with a wrong
 *     secret, can never choose its IP: it gets the socket peer, exactly as `req.ip` gave before.
 *   - Only the entry GATEWAY_FRONT_PROXY_HOPS places from the right is used (default 1; entries further left are client-controlled
 *     and are never looked at). It must be a valid IP; anything else, or fewer entries than hops, falls back to the socket peer.
 *     0 means "the gateway is reached directly": the header is ignored.
 *   - The secret is checked HERE, before the auth middleware, because authMiddleware deletes x-gateway-secret from the request once
 *     the token is verified.
 * Limit of the FALLBACK only (gateway-owned): if the gateway itself is reached with no front proxy, the X-Forwarded-For it forwards
 * is whatever the client sent. The gateway's own x-client-ip stamp closes that, which is why it is preferred.
 * Unchanged when the request does not come through the gateway (AWS Lambda/API Gateway, direct calls, tests).
 */

export interface ClientIpInput {
  viaGateway: boolean;
  /** The gateway's own stamp (`x-client-ip`); only looked at when viaGateway. */
  stamped?: string | string[] | undefined;
  forwardedFor: string | string[] | undefined;
  hops: number;
  peer: string | null | undefined;
}

function normalise(ip: string): string {
  return ip.toLowerCase().startsWith("::ffff:") && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
}

/** Pure decision, exported for the tests. */
export function clientIpFrom(input: ClientIpInput): string | null {
  const peer = input.peer ?? null;
  if (input.viaGateway && input.stamped !== undefined) {
    const raw = Array.isArray(input.stamped) ? input.stamped[0] : input.stamped;
    const stamped = typeof raw === "string" ? raw.trim() : "";
    if (stamped && net.isIP(stamped)) return normalise(stamped);
  }
  if (!input.viaGateway || !input.forwardedFor || !Number.isInteger(input.hops) || input.hops < 1) return peer;
  const joined = Array.isArray(input.forwardedFor) ? input.forwardedFor.join(",") : input.forwardedFor;
  const entries = joined.split(",").map((s) => s.trim());
  const candidate = entries.length >= input.hops ? entries[entries.length - input.hops] : "";
  return candidate && net.isIP(candidate) ? normalise(candidate) : peer;
}

function frontProxyHops(): number {
  const raw = process.env.GATEWAY_FRONT_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

export function clientIpMiddleware(req: Request, _res: Response, next: NextFunction) {
  const secret = req.headers["x-gateway-secret"];
  const value = Array.isArray(secret) ? secret[0] : secret;
  (req as Request & { clientIp?: string | null }).clientIp = clientIpFrom({
    viaGateway: isAcceptedServiceSecret(value),
    stamped: req.headers["x-client-ip"],
    forwardedFor: req.headers["x-forwarded-for"],
    hops: frontProxyHops(),
    peer: req.ip || req.socket.remoteAddress,
  });
  next();
}
