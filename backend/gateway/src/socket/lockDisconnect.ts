import type { NextFunction, Request, Response } from "express";
import { logger } from "@gym-coach/shared";
import { disconnectUserSockets, getSocketServer } from "./index";

const DISABLE_PATH = /^\/admin\/users\/([^/?#]+)\/disable\/?(?:[?#].*)?$/;

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
      } catch (err) {
        logger.warn({ message: err instanceof Error ? err.message : String(err) }, "Could not cut sockets of locked user");
      }
    });
  }
  next();
}
