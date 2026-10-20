import type { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';

/**
 * Listing Management B1 — telemetry + the shared answers for old clients on routes the listing flow replaced.
 * Same shape as user-service's client-compat.service.ts (plan 12.13 item 10).
 *
 * `client_compat_events` is best-effort evidence only (it measures how much traffic still comes from clients that
 * predate the listing flow); it never decides a response. The primary evidence is `legacy_compat_events`.
 */
export type ClientCompatOutcome =
  | 'LEGACY_ACCEPTED'
  | 'REVIEW_REQUIRED_409'
  | 'UPLOAD_RETIRED_410'
  | 'PACKAGE_VERSION_MISSING';

export const LISTING_REVIEW_REQUIRED_MESSAGE = 'Thay đổi này cần gửi duyệt. Hãy cập nhật ứng dụng để dùng mục Tin đăng.';
export const UPLOAD_ROUTE_RETIRED_MESSAGE = 'Cách tải ảnh này đã ngừng hoạt động. Hãy cập nhật ứng dụng để tải ảnh trong mục Tin đăng.';

/** The `X-Gymini-Client` header (web/<gitsha> or mobile/<version>/<build>), or null when the client sent none. */
export function clientHeaderOf(req: Pick<Request, 'headers'>): string | null {
  const raw = req.headers?.['x-gymini-client'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}

/**
 * Best-effort insert: a failure is logged and swallowed, so the request that triggered it is never affected.
 * Resolves when the write has finished (tests await it).
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
    logger.warn({ message: (error as Error)?.message, outcome: event.outcome }, '[ClientCompat] could not record event');
  }
}

/** Marks an error the owner-edit service raises on purpose when a change must go through a reviewed revision. */
export const LISTING_REVIEW_REQUIRED = 'LISTING_REVIEW_REQUIRED';

export function listingReviewRequiredError(): Error {
  return Object.assign(new Error(LISTING_REVIEW_REQUIRED_MESSAGE), { status: 409, code: LISTING_REVIEW_REQUIRED });
}

/**
 * 409 LISTING_REVIEW_REQUIRED: the change belongs in a reviewed revision, not a direct write. Body shape is the one
 * old mobile builds already know how to read (`message`, and `error.message`), identical to user-service's.
 * Telemetry: one client_compat_events row (best-effort, never affects the response).
 */
export async function sendListingReviewRequired(req: Request, res: Response): Promise<void> {
  await recordClientCompatEvent({
    route: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
    actorUserId: req.user?.userId ?? null,
    clientHeader: clientHeaderOf(req),
    outcome: 'REVIEW_REQUIRED_409',
  });
  res.status(409).json({
    success: false,
    error: { code: LISTING_REVIEW_REQUIRED, message: LISTING_REVIEW_REQUIRED_MESSAGE },
    message: LISTING_REVIEW_REQUIRED_MESSAGE,
  });
}

/** 410 UPLOAD_ROUTE_RETIRED: the disk-photo routes are gone for every gym status (a STAGED photo never sits on the
 * public disk). Same body shape as above. */
export async function sendUploadRouteRetired(req: Request, res: Response): Promise<void> {
  await recordClientCompatEvent({
    route: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
    actorUserId: req.user?.userId ?? null,
    clientHeader: clientHeaderOf(req),
    outcome: 'UPLOAD_RETIRED_410',
  });
  res.status(410).json({
    success: false,
    error: { code: 'UPLOAD_ROUTE_RETIRED', message: UPLOAD_ROUTE_RETIRED_MESSAGE },
    message: UPLOAD_ROUTE_RETIRED_MESSAGE,
  });
}
