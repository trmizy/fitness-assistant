import { Request, Response } from "express";
import * as DropboxSign from "@dropbox/sign";
import { dropboxSignWebhookService } from "../services/dropboxSignWebhook.service";

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

  // Verify event using Dropbox Sign SDK helper. Signature verification is only skipped when the
  // e-sign provider is explicitly MOCK (dev/test). For any real provider we FAIL CLOSED: a missing
  // API key or an invalid signature is rejected, so a misconfigured production can't accept forged
  // webhooks that flip contract/signature state.
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  const isMockEsign = (process.env.ESIGN_PROVIDER || "").toUpperCase() === "MOCK";
  if (!isMockEsign) {
    if (!apiKey) {
      res.status(500).send("E-sign webhook verification is not configured");
      return;
    }
    try {
      const eventCallback = DropboxSign.EventCallbackRequest.init(parsedData);
      const isValid = DropboxSign.EventCallbackHelper.isValid(apiKey, eventCallback);
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
