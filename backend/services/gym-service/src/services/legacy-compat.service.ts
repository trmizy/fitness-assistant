import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { withCompatWriter } from '../repositories/compat-writer';
import { logger } from '@gym-coach/shared';
import type { NextFunction, Response } from 'express';
import { clientHeaderOf } from './client-compat.service';

/**
 * Listing Management B3 - the single implementation of plan section 4 / 12.8 / 12.14 item 4 / 12.15 items 3-4:
 * how a request from a client that predates the amenity step (an "old APK") is recognised, accepted or refused, and
 * how every such request leaves evidence in `legacy_compat_events`.
 *
 *  - ONE flag: LISTING_LEGACY_CLIENT_COMPAT, default TRUE in every environment. It only decides whether an application
 *    / branch that arrives WITHOUT amenities from an old client is accepted (true) or refused 422 AMENITIES_REQUIRED (false).
 *  - ONE header: `X-Gymini-Listing-Flow: <integer >= 2>` = a new client ("2" today, "3" later...). Missing, "1" or anything that is
 *    not a plain integer = an old client. The raw value is stored as flow_header; the numeric value as the entity's flow version.
 *    `X-Gymini-Client` is only measured (client_header), it never decides behaviour.
 *  - ACCEPTED event: written in the SAME transaction as the business write, and the entity's `legacy_client_at` is set to the
 *    same `now()` as the event's `occurred_at` (both statements run in one transaction, so now() is one instant) - that
 *    equality is what the compat report's reconciliation query relies on.
 *  - REJECTED_422 event: written in its OWN transaction (the business transaction rolled back), carries no entity update.
 *  - REJECTED_OTHER event: every OTHER 4xx refusal of an old-client request on a compat route (validation, locked, forbidden, not found...)
 *    - written by legacyCompatRefusalGuard, in its own transaction, BEFORE the response goes out. If the insert fails the failure is
 *    logged as an error and the original error response is still returned.
 *  - A request WITH the new header never writes an event (the log measures old clients only).
 */

export const LISTING_FLOW_HEADER = 'x-gymini-listing-flow';
/** The first flow version of a "new client" (the amenity step). */
export const NEW_CLIENT_MIN_FLOW = 2;

/** An integer >= 2 (1-4 digits). "1", "", "abc", "2.5", "-3" and absurdly long numbers are NOT new clients. */
export function flowVersionOf(flowHeader: string | null | undefined): number | null {
  if (typeof flowHeader !== 'string' || !/^\d{1,4}$/.test(flowHeader)) return null;
  const n = Number(flowHeader);
  return n >= NEW_CLIENT_MIN_FLOW ? n : null;
}
export const isNewClientFlowHeader = (flowHeader: string | null | undefined) => flowVersionOf(flowHeader) !== null;

export const AMENITIES_REQUIRED = 'AMENITIES_REQUIRED';
export const AMENITIES_REQUIRED_NEW_CLIENT_MESSAGE = 'Hãy chọn ít nhất một tiện ích cho chi nhánh trước khi gửi duyệt.';
export const AMENITIES_REQUIRED_LEGACY_MESSAGE =
  'Phiên bản ứng dụng này không còn hỗ trợ gửi hồ sơ hoặc chi nhánh thiếu tiện ích. Hãy cập nhật ứng dụng để thêm tiện ích.';

export type LegacyCompatAction =
  | 'APPLICATION_BOOTSTRAP'
  | 'APPLICATION_SAVE_STEP'
  | 'APPLICATION_SUBMIT'
  | 'APPLICATION_RESUBMIT'
  | 'BRANCH_CREATE_QUICK'
  | 'BRANCH_DRAFT_CREATE'
  | 'BRANCH_DRAFT_SAVE'
  | 'BRANCH_DRAFT_SUBMIT';

export type LegacyCompatEntityType = 'GYM_PARTNER' | 'GYM';

/** What the request says about its client. Built once per request by the controller and handed to the service. */
export interface ListingCompat {
  /** true for `X-Gymini-Listing-Flow` = an integer >= 2 */
  newClient: boolean;
  /** that integer (what application_flow_version / created_flow_version store), or null for an old client */
  flowVersion: number | null;
  /** the raw header value, or null when absent (recorded as flow_header) */
  flowHeader: string | null;
  /** `X-Gymini-Client`, or null (recorded as client_header) */
  clientHeader: string | null;
}

export function listingCompatOf(req: Pick<Request, 'headers'>): ListingCompat {
  const raw = req.headers?.[LISTING_FLOW_HEADER];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const flowHeader = typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null;
  const flowVersion = flowVersionOf(flowHeader);
  return { newClient: flowVersion !== null, flowVersion, flowHeader, clientHeader: clientHeaderOf(req) };
}

/** The compat context of a caller that is not an HTTP request (tests, scripts): a NEW client. */
export const NEW_CLIENT_COMPAT: ListingCompat = { newClient: true, flowVersion: 2, flowHeader: '2', clientHeader: null };

/** LISTING_LEGACY_CLIENT_COMPAT: default TRUE everywhere; only an explicit "false" / "0" turns it off. Read on every call. */
export function isLegacyCompatEnabled(): boolean {
  const v = (process.env.LISTING_LEGACY_CLIENT_COMPAT ?? '').trim().toLowerCase();
  return !(v === 'false' || v === '0');
}

/**
 * Whether this request has to carry >= 1 amenity: a new client always; an entity already created by flow 2 always; an old
 * client only once the compat flag is off.
 */
export function amenitiesRequired(compat: ListingCompat, entityFlowVersion: number | null | undefined): boolean {
  return compat.newClient || (entityFlowVersion ?? 0) >= NEW_CLIENT_MIN_FLOW || !isLegacyCompatEnabled();
}

export function amenitiesRequiredError(compat: ListingCompat): Error {
  const message = compat.newClient ? AMENITIES_REQUIRED_NEW_CLIENT_MESSAGE : AMENITIES_REQUIRED_LEGACY_MESSAGE;
  return Object.assign(new Error(message), { status: 422, code: AMENITIES_REQUIRED });
}

type Tx = Prisma.TransactionClient;

export interface LegacyCompatEventInput {
  action: LegacyCompatAction;
  entityType: LegacyCompatEntityType;
  entityId: string;
  actorUserId: string | null;
  flowHeader: string | null;
  clientHeader: string | null;
  outcome: 'ACCEPTED' | 'REJECTED_422' | 'REJECTED_OTHER';
  /** ACCEPTED only: the entity's current "arrived without amenities" state (left unchanged when undefined). */
  legacyNoAmenities?: boolean;
}

/**
 * Writes the legacy-compat evidence for ONE request, inside the caller's transaction.
 *
 *  - Does nothing (returns false) when the request carried a new-client `X-Gymini-Listing-Flow` (an integer >= 2).
 *  - ACCEPTED: INSERT the event AND `UPDATE <entity> SET legacy_client_at = now()` (+ legacy_no_amenities when given) in the
 *    caller's transaction - same now() for both. The transaction is marked as an event-aware writer first (it UPDATEs gyms /
 *    gym_partners), so the database trigger never records WRITER_ABSENT for it.
 *  - REJECTED_422: only the event row; use recordLegacyRejectedEvent (its own transaction) for that outcome.
 */
export async function recordLegacyCompatTx(tx: Tx, e: LegacyCompatEventInput): Promise<boolean> {
  if (isNewClientFlowHeader(e.flowHeader)) return false;
  await withCompatWriter(tx);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO legacy_compat_events (id, occurred_at, outcome, action, entity_type, entity_id, actor_user_id, flow_header, client_header)
    VALUES (${randomUUID()}, now(), ${e.outcome}::"LegacyCompatOutcome", ${e.action}, ${e.entityType}::"LegacyCompatEntityType",
            ${e.entityId}, ${e.actorUserId}, ${e.flowHeader}, ${e.clientHeader})`);
  if (e.outcome === 'ACCEPTED') {
    const noAmenities = e.legacyNoAmenities ?? null;
    if (e.entityType === 'GYM_PARTNER') {
      await tx.$executeRaw(Prisma.sql`
        UPDATE gym_partners SET legacy_client_at = now(), legacy_no_amenities = COALESCE(${noAmenities}::boolean, legacy_no_amenities)
         WHERE id = ${e.entityId}`);
    } else {
      await tx.$executeRaw(Prisma.sql`
        UPDATE gyms SET legacy_client_at = now(), legacy_no_amenities = COALESCE(${noAmenities}::boolean, legacy_no_amenities)
         WHERE id = ${e.entityId}`);
    }
  }
  return true;
}

/**
 * REJECTED_422 / REJECTED_OTHER: the business transaction already rolled back (or never started), so the event gets a transaction
 * of its own and the entity is not touched. A failing insert is logged as an ERROR and swallowed: the caller is about to return
 * the ORIGINAL error to the client and must still do so.
 */
export async function recordLegacyRejectedEvent(
  e: Omit<LegacyCompatEventInput, 'outcome' | 'legacyNoAmenities'>,
  outcome: 'REJECTED_422' | 'REJECTED_OTHER' = 'REJECTED_422',
): Promise<boolean> {
  if (isNewClientFlowHeader(e.flowHeader)) return false;
  try {
    return await prisma.$transaction((tx) => recordLegacyCompatTx(tx, { ...e, outcome }));
  } catch (error) {
    logger.error({ err: (error as Error)?.message, action: e.action, entityId: e.entityId, outcome }, '[LegacyCompat] could not record the refusal event');
    return false;
  }
}

/** `application_flow_version` = the request's flow version (never downgraded) on the partner, when the request is from a new client. */
export async function markApplicationFlowTx(tx: Tx, partnerId: string, compat: ListingCompat): Promise<void> {
  if (compat.flowVersion === null) return;
  await withCompatWriter(tx);
  await tx.$executeRaw(Prisma.sql`
    UPDATE gym_partners SET application_flow_version = ${compat.flowVersion}
     WHERE id = ${partnerId} AND (application_flow_version IS NULL OR application_flow_version < ${compat.flowVersion})`);
}

/** The compat context of a caller that passes none (an internal call, an older test): a request WITHOUT the header = an old client. */
export const LEGACY_NO_HEADER: ListingCompat = { newClient: false, flowVersion: null, flowHeader: null, clientHeader: null };

/** `{ createdFlowVersion }` for a branch create, or nothing for an old client. */
export const createdFlowVersionData = (compat: ListingCompat) => (compat.flowVersion !== null ? { createdFlowVersion: compat.flowVersion } : {});

/** `legacy_no_amenities` describes the CURRENT state: once the entity has an amenity it is no longer "without amenities". */
export async function clearLegacyNoAmenitiesTx(tx: Tx, entityType: LegacyCompatEntityType, entityId: string): Promise<void> {
  await withCompatWriter(tx);
  if (entityType === 'GYM_PARTNER') {
    await tx.$executeRaw(Prisma.sql`UPDATE gym_partners SET legacy_no_amenities = false WHERE id = ${entityId} AND legacy_no_amenities`);
  } else {
    await tx.$executeRaw(Prisma.sql`UPDATE gyms SET legacy_no_amenities = false WHERE id = ${entityId} AND legacy_no_amenities`);
  }
}

// ═══ every refusal of an old-client request on a compat route leaves an event ═══════════════════════

interface CompatRoute {
  method: string;
  pattern: RegExp;
  action: LegacyCompatAction;
  /** whose id the event carries: the caller's partner record, or the branch in the URL (capture group 1) */
  entity: 'PARTNER' | 'GYM_IN_URL';
}

/** The routes plan 12.14 item 4 lists. Paths are the ones the gateway forwards unchanged (/owner/...). */
const COMPAT_ROUTES: CompatRoute[] = [
  { method: 'POST', pattern: /^\/owner\/application\/bootstrap\/?$/, action: 'APPLICATION_BOOTSTRAP', entity: 'PARTNER' },
  {
    method: 'PUT',
    pattern: /^\/owner\/application\/(representative|business-scale|brand|branch|social|legal|amenities|photos\/reorder)\/?$/,
    action: 'APPLICATION_SAVE_STEP',
    entity: 'PARTNER',
  },
  { method: 'POST', pattern: /^\/owner\/application\/submit\/?$/, action: 'APPLICATION_SUBMIT', entity: 'PARTNER' },
  { method: 'POST', pattern: /^\/owner\/application\/resubmit\/?$/, action: 'APPLICATION_RESUBMIT', entity: 'PARTNER' },
  { method: 'POST', pattern: /^\/owner\/gyms\/?$/, action: 'BRANCH_CREATE_QUICK', entity: 'PARTNER' },
  { method: 'POST', pattern: /^\/owner\/gyms\/draft\/?$/, action: 'BRANCH_DRAFT_CREATE', entity: 'PARTNER' },
  { method: 'PATCH', pattern: /^\/owner\/gyms\/([^/]+)\/draft\/?$/, action: 'BRANCH_DRAFT_SAVE', entity: 'GYM_IN_URL' },
  { method: 'POST', pattern: /^\/owner\/gyms\/([^/]+)\/submit\/?$/, action: 'BRANCH_DRAFT_SUBMIT', entity: 'GYM_IN_URL' },
];

/** The compat route a request is, or null. */
export function compatRouteOf(method: string, url: string): { route: CompatRoute; gymId: string | null } | null {
  const pathname = url.split('?')[0];
  for (const route of COMPAT_ROUTES) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(pathname);
    if (m) return { route, gymId: route.entity === 'GYM_IN_URL' ? decodeURIComponent(m[1]) : null };
  }
  return null;
}

/**
 * Express middleware (mounted at app level, before the body parser and the routers): for a request WITHOUT the new-client header on
 * one of the compat routes, a 4xx response (other than 401, which has no identity to attribute, and other than the 422
 * AMENITIES_REQUIRED the services record themselves as REJECTED_422) first writes a REJECTED_OTHER event - own transaction, awaited
 * before the response is sent - and then sends the ORIGINAL response unchanged. A failing insert is logged as an error only.
 * It hooks res.send (res.json calls it), so refusals from the body parser, the validators, the auth / partner guards and the
 * handlers are all seen.
 */
export function legacyCompatRefusalGuard(req: Request, res: Response, next: NextFunction): void {
  const hit = compatRouteOf(req.method, req.originalUrl || req.url);
  if (!hit) return next();
  const compat = listingCompatOf(req);
  if (compat.newClient) return next();

  const original = res.send.bind(res);
  let intercepted = false;
  res.send = ((body?: unknown) => {
    const status = res.statusCode;
    const text = typeof body === 'string' ? body : '';
    const selfRecorded = status === 422 && text.includes('"AMENITIES_REQUIRED"');
    if (intercepted || status < 400 || status >= 500 || status === 401 || selfRecorded || !req.user?.userId) return original(body as never);
    intercepted = true;
    void (async () => {
      try {
        const userId = req.user!.userId;
        let entityType: LegacyCompatEntityType = 'GYM';
        let entityId = hit.gymId;
        if (!entityId) {
          entityType = 'GYM_PARTNER';
          entityId =
            req.partner?.partnerId ??
            (await prisma.gymPartnerAccount.findUnique({ where: { userId }, select: { partnerId: true } }))?.partnerId ??
            userId; // no partner record yet (e.g. a bootstrap that was refused): the caller's user id stands in
        }
        await recordLegacyRejectedEvent(
          { action: hit.route.action, entityType, entityId, actorUserId: userId, flowHeader: compat.flowHeader, clientHeader: compat.clientHeader },
          'REJECTED_OTHER',
        );
      } catch (error) {
        logger.error({ err: (error as Error)?.message, action: hit.route.action }, '[LegacyCompat] could not record the refusal event');
      } finally {
        original(body as never);
      }
    })();
    return res;
  }) as typeof res.send;
  next();
}
