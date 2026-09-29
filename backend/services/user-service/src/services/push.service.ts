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

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;
  const res = await fetch(TOKEN_URL, {
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
 * FCM's way of saying "this token will never work again" — delete it rather than retry.
 * INVALID_ARGUMENT is deliberately NOT here: it also means "your message is malformed", and
 * a payload bug must not silently unsubscribe every phone.
 */
export function isDeadToken(status: number, body: unknown): boolean {
  if (status === 404) return true;
  const details = (body as { error?: { details?: Array<{ errorCode?: string }> } })?.error?.details ?? [];
  return details.some((d) => d.errorCode === "UNREGISTERED");
}

export const pushService = {
  async sendToUser(n: PushableNotification): Promise<void> {
    try {
      const sa = account();
      if (!sa) return;
      const tokens = await pushDeviceRepository.tokensForUser(n.userId);
      if (tokens.length === 0) return;
      const bearer = await accessToken(sa);
      await Promise.all(
        tokens.map(async (token) => {
          const res = await fetch(
            `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
              body: JSON.stringify(buildMessage(token, n)),
            },
          );
          if (res.ok) return;
          const body = await res.json().catch(() => null);
          if (isDeadToken(res.status, body)) {
            await pushDeviceRepository.forget(token);
            logger.info({ userId: n.userId }, "[push] dropped a dead device token");
          } else {
            logger.warn({ status: res.status, userId: n.userId }, "[push] FCM send failed");
          }
        }),
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message, userId: n.userId }, "[push] send skipped");
    }
  },
};
