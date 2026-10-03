import { createSign } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { logger } from "@gym-coach/shared";
import { pushDeviceRepository } from "../repositories/push-device.repository";

/**
 * Mobile Phase 14.2 — delivers every persisted notification to the user's phones through
 * Firebase Cloud Messaging (HTTP v1).
 *
 * Deliberately dependency-free: the OAuth token is minted from the service account with
 * node:crypto (an RS256-signed JWT exchanged at Google's token endpoint) instead of pulling
 * firebase-admin into this service. It is best-effort by construction — nothing here throws
 * back into notificationService.create(): the in-app notification row and the socket push
 * are the source of truth, a phone push is only a nudge towards them.
 *
 * Credentials, first match wins:
 *   FIREBASE_SERVICE_ACCOUNT_JSON — the key file's JSON inline (Lambda / secret managers)
 *   FIREBASE_CREDENTIALS_DIR      — a directory holding the downloaded key file (default
 *                                   /app/secret, mounted read-only by the dev compose file)
 * With neither, push is off and one warning is logged; everything else keeps working.
 */

export type ServiceAccount = { project_id: string; client_email: string; private_key: string };

type PushableNotification = {
  id: string;
  userId: string;
  text: string;
  eventType: string;
  entityType: string;
  entityId: string;
  link?: string | null;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Must match the channel the app creates (src/features/push in frontend/mobile). */
export const ANDROID_CHANNEL_ID = "default";

function isServiceAccount(value: unknown): value is ServiceAccount {
  const v = value as Record<string, unknown> | null;
  return (
    !!v &&
    v.type === "service_account" &&
    typeof v.project_id === "string" &&
    typeof v.client_email === "string" &&
    typeof v.private_key === "string"
  );
}

let cachedAccount: ServiceAccount | null | undefined;

export function loadServiceAccount(env: NodeJS.ProcessEnv = process.env): ServiceAccount | null {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (isServiceAccount(parsed)) return parsed;
    } catch {
      // fall through to the directory
    }
    logger.warn("[push] FIREBASE_SERVICE_ACCOUNT_JSON is set but is not a service-account key");
  }
  const dir = env.FIREBASE_CREDENTIALS_DIR || "/app/secret";
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf-8"));
      if (isServiceAccount(parsed)) return parsed;
    } catch {
      // not a key file — keep looking
    }
  }
  return null;
}

function account(): ServiceAccount | null {
  if (cachedAccount === undefined) {
    cachedAccount = loadServiceAccount();
    if (cachedAccount) logger.info({ projectId: cachedAccount.project_id }, "[push] FCM enabled");
    else logger.warn("[push] no Firebase service account found — phone push is OFF");
  }
  return cachedAccount;
}

const base64url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The self-signed assertion Google exchanges for an access token (RFC 7523). */
export function signAssertion(sa: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * One retry on a NETWORK failure (fetch threw), never on an HTTP answer. Seen in dev: a single
 * "fetch failed" from the container to Google dropped an incoming-call push whose whole useful
 * life is the 30 s ring.
 */
async function fetchOnceMore(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return fetch(url, init);
  }
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;
  const res = await fetchOnceMore(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signAssertion(sa, Math.floor(now / 1000)),
    }),
  });
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return body.access_token;
}

/**
 * One FCM message. `data` carries what the app needs to route a tap (and to check the push
 * is really for whoever is signed in now); every value must be a string for FCM.
 */
export function buildMessage(token: string, n: PushableNotification) {
  return {
    message: {
      token,
      notification: { title: "Gymini", body: n.text },
      data: {
        notificationId: n.id,
        userId: n.userId,
        eventType: n.eventType,
        entityType: n.entityType,
        entityId: n.entityId,
        link: n.link ?? "",
      },
      android: { priority: "HIGH", notification: { channel_id: ANDROID_CHANNEL_ID } },
    },
  };
}

/**
 * A push that is NOT a row in the notifications table — the realtime nudges chat-service sends
 * (an incoming call, a new chat message: E2/E3). The bell list would drown in those, and the
 * conversation itself already records them. `kind` lets the app route a tap and decide whether
 * to show it while open; `tag` makes a later push replace an earlier one in the shade (the
 * "đang gọi" notice becomes "cuộc gọi nhỡ"; a conversation keeps only its latest message);
 * `ttlSeconds` stops a stale ring from being delivered after the call is long over.
 */
export type RawPush = {
  userId: string;
  title: string;
  body: string;
  kind: "CALL" | "CHAT";
  link?: string | null;
  data?: Record<string, string>;
  tag?: string;
  ttlSeconds?: number;
};

export function buildRawMessage(token: string, p: RawPush) {
  return {
    message: {
      token,
      notification: { title: p.title, body: p.body },
      data: { ...(p.data ?? {}), kind: p.kind, userId: p.userId, link: p.link ?? "" },
      android: {
        priority: "HIGH",
        ...(p.ttlSeconds ? { ttl: `${Math.max(1, Math.floor(p.ttlSeconds))}s` } : {}),
        notification: { channel_id: ANDROID_CHANNEL_ID, ...(p.tag ? { tag: p.tag } : {}) },
      },
    },
  };
}

/**
 * FCM's way of saying "this token will never work again" — delete it rather than retry.
 * INVALID_ARGUMENT is deliberately NOT here: it also means "your message is malformed", and
 * a payload bug must not silently unsubscribe every phone.
 */
export function isDeadToken(status: number, body: unknown): boolean {
  if (status === 404) return true;
  const details = (body as { error?: { details?: Array<{ errorCode?: string }> } })?.error?.details ?? [];
  return details.some((d) => d.errorCode === "UNREGISTERED");
}

/** Sends one message per registered device; best-effort, never throws. */
async function sendToDevices(userId: string, build: (token: string) => unknown): Promise<void> {
  try {
    const sa = account();
    if (!sa) return;
    const tokens = await pushDeviceRepository.tokensForUser(userId);
    if (tokens.length === 0) return;
    const bearer = await accessToken(sa);
    await Promise.all(
      tokens.map(async (token) => {
        const res = await fetchOnceMore(
          `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
            body: JSON.stringify(build(token)),
          },
        );
        if (res.ok) return;
        const body = await res.json().catch(() => null);
        if (isDeadToken(res.status, body)) {
          await pushDeviceRepository.forget(token);
          logger.info({ userId }, "[push] dropped a dead device token");
        } else {
          logger.warn({ status: res.status, userId }, "[push] FCM send failed");
        }
      }),
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, "[push] send skipped");
  }
}

export const pushService = {
  async sendToUser(n: PushableNotification): Promise<void> {
    await sendToDevices(n.userId, (token) => buildMessage(token, n));
  },

  /** E2/E3 — a realtime nudge with no notifications-table row (see RawPush). */
  async sendRaw(p: RawPush): Promise<void> {
    await sendToDevices(p.userId, (token) => buildRawMessage(token, p));
  },
};
