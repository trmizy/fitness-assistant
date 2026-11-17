import type { NextFunction, Request, Response } from "express";
import axios from "axios";
import { logger } from "@gym-coach/shared";
import { disconnectUserSockets, getSocketServer } from "./index";
import { INTERNAL_SERVICE_SECRET_DEFAULT } from "../utils/internal-secret";

// Both ways an account lock reaches auth-service through the gateway: the admin route and the raw /auth passthrough.
const DISABLE_PATH = /^\/(?:admin|auth)\/users\/([^/?#]+)\/disable\/?(?:[?#].*)?$/;

/**
 * Chat-service keeps its OWN Socket.IO server (chat + calls, proxied at /chat-socket.io) that the gateway's
 * disconnect cannot reach, so the lock is relayed to it too (N11F-03). Best effort: chat-service accepts either
 * shared secret, so each one this process knows is tried until one is accepted.
 */
export async function disconnectChatServiceSockets(userId: string): Promise<boolean> {
  const base = (process.env.CHAT_SERVICE_URL || "http://localhost:3005").replace(/\/+$/, "");
  const secrets = [
    ...new Set(
      [process.env.INTERNAL_API_SECRET, process.env.INTERNAL_SERVICE_SECRET || INTERNAL_SERVICE_SECRET_DEFAULT].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  ];
  for (const secret of secrets) {
    try {
      await axios.post(`${base}/internal/users/${encodeURIComponent(userId)}/disconnect`, {}, {
        headers: { "x-internal-secret": secret },
        timeout: 3000,
      });
      return true;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 401) {
        logger.warn({ message: err instanceof Error ? err.message : String(err) }, "Could not cut chat-service sockets of locked user");
        return false;
      }
    }
  }
  logger.warn("Chat-service refused every internal secret when cutting sockets of a locked user");
  return false;
}

/** The user an admin lock request is aimed at, or null when this request is not one. */
export function lockedUserIdFromRequest(method: string | undefined, url: string | undefined): string | null {
  if (method !== "PATCH" || !url) return null;
  const match = DISABLE_PATH.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * When the admin "lock account" call finishes successfully, cut the locked user's open gateway
 * sockets. A socket authenticates only at the handshake, so without this an already-open connection
 * keeps receiving chat messages and notifications until it drops by itself. It only listens to the
 * response status; the route itself (auth, role check, auth-service call) is untouched.
 */
export function disconnectSocketsOfLockedUser(req: Request, res: Response, next: NextFunction) {
  const userId = lockedUserIdFromRequest(req.method, req.originalUrl);
  if (userId) {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      try {
        disconnectUserSockets(getSocketServer(), userId);
        void disconnectChatServiceSockets(userId);
      } catch (err) {
        logger.warn({ message: err instanceof Error ? err.message : String(err) }, "Could not cut sockets of locked user");
      }
    });
  }
  next();
}
