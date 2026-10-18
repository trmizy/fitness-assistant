import type { Request } from "express";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/profile.repository";

/**
 * Outcomes written to client_compat_events (plan §12.13 item 10). Telemetry only - it measures how much traffic
 * still comes from clients that predate the listing flow, so the compatibility behaviour can be switched off with
 * evidence. It is NOT a source of truth for anything and never decides a response.
 */
export type ClientCompatOutcome =
  | "LEGACY_ACCEPTED"
  | "REVIEW_REQUIRED_409"
  | "UPLOAD_RETIRED_410"
  | "PACKAGE_VERSION_MISSING";

/** The `X-Gymini-Client` header (web/<gitsha> or mobile/<version>/<build>), or null when the client sent none. */
export function clientHeaderOf(req: Pick<Request, "headers">): string | null {
  const raw = req.headers?.["x-gymini-client"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null;
}

/**
 * Best-effort insert: a failure is logged and swallowed, so the request that triggered it is never affected.
 * Resolves when the write has finished (tests await it); callers on a hot path may simply not await.
 */
export async function recordClientCompatEvent(event: {
  route: string;
  actorUserId?: string | null;
  clientHeader?: string | null;
  outcome: ClientCompatOutcome;
}): Promise<void> {
  try {
    await prisma.clientCompatEvent.create({
      data: {
        route: event.route.slice(0, 200),
        actorUserId: event.actorUserId ?? null,
        clientHeader: event.clientHeader ?? null,
        outcome: event.outcome,
      },
    });
  } catch (error) {
    logger.warn({ message: (error as Error)?.message, outcome: event.outcome }, "[ClientCompat] could not record event");
  }
}
