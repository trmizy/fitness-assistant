import { Request, Response } from "express";
import * as DropboxSign from "@dropbox/sign";
import { dropboxSignWebhookService } from "../services/dropboxSignWebhook.service";

/**
 * Fail-closed rule: a missing DROPBOX_SIGN_API_KEY must NEVER be treated as
 * "skip verification" in production — that previously let anyone POST an
 * unsigned, fabricated event to this endpoint and flip a real contract's
 * signing status (e.g. straight to PENDING_PAYMENT) with no verification at
 * all, simply by having a misconfigured/missing key in the deployment.
 * Skipping verification is only ever acceptable outside production, and only
 * when the operator has deliberately opted into the mock e-sign provider
 * (ESIGN_PROVIDER=MOCK) — never as a silent fallback for "key happens to be
 * absent."
 */
export function canSkipDropboxSignVerification(env: {
  isProduction: boolean;
  isMockEsignProvider: boolean;
}): boolean {
  return !env.isProduction && env.isMockEsignProvider;
}

export async function handleDropboxSignWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const rawJson: string | undefined = req.body?.["json"];

  if (!rawJson) {
    res.status(400).send("Missing json field");
    return;
  }

  let parsedData: any;
  try {
    parsedData = JSON.parse(rawJson);
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  const apiKey = process.env.DROPBOX_SIGN_API_KEY;

  if (!apiKey) {
    const canSkip = canSkipDropboxSignVerification({
      isProduction: process.env.NODE_ENV === "production",
      isMockEsignProvider: process.env.ESIGN_PROVIDER === "MOCK",
    });
    if (!canSkip) {
      res
        .status(503)
        .send("E-sign webhook verification is not configured");
      return;
    }
    // ESIGN_PROVIDER=MOCK, non-production: no real Dropbox Sign key exists
    // to verify against — this path is only reachable in local/dev/test.
  } else {
    try {
      const eventCallback = DropboxSign.EventCallbackRequest.init(parsedData);
      const isValid = DropboxSign.EventCallbackHelper.isValid(
        apiKey,
        eventCallback,
      );
      if (!isValid) {
        res.status(401).send("Invalid event signature");
        return;
      }
    } catch {
      res.status(401).send("Event verification failed");
      return;
    }
  }

  // Dropbox Sign requires this exact response body
  res.status(200).send("Hello API Event Received");

  // Parse camelCase event fields from SDK init
  const eventCallback = DropboxSign.EventCallbackRequest.init(parsedData);
  const event = {
    event: {
      eventType: eventCallback.event?.eventType,
    },
    signatureRequest: eventCallback.signatureRequest
      ? {
          signatureRequestId: eventCallback.signatureRequest.signatureRequestId,
          signatures: eventCallback.signatureRequest.signatures,
        }
      : undefined,
  };

  dropboxSignWebhookService
    .handleEvent(event)
    .catch((err: any) =>
      console.error("[DropboxSignWebhook] handleEvent error:", err?.message),
    );
}
