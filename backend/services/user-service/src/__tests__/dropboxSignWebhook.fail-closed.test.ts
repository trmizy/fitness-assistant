/**
 * Regression tests for the P0 vulnerability found and fixed in this pass:
 * the Dropbox Sign webhook controller previously skipped signature
 * verification entirely whenever DROPBOX_SIGN_API_KEY was unset — including
 * in production, if the key was simply missing/misconfigured — meaning
 * anyone could POST a fabricated event to /webhooks/dropbox-sign and flip a
 * real contract's e-sign status (straight to PENDING_PAYMENT) with zero
 * verification.
 *
 * Covers both the extracted pure decision function
 * (canSkipDropboxSignVerification) and a full HTTP-level test against the
 * real Express route, confirming the fabricated event is rejected with 503
 * and never reaches dropboxSignWebhookService.handleEvent (i.e. no contract
 * is touched) when the key is missing outside the explicit MOCK-provider dev
 * escape hatch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { canSkipDropboxSignVerification } from "../controllers/dropboxSignWebhook.controller";

test("canSkipDropboxSignVerification: false in production regardless of ESIGN_PROVIDER", () => {
  assert.equal(canSkipDropboxSignVerification({ isProduction: true, isMockEsignProvider: true }), false);
  assert.equal(canSkipDropboxSignVerification({ isProduction: true, isMockEsignProvider: false }), false);
});

test("canSkipDropboxSignVerification: false outside production unless ESIGN_PROVIDER=MOCK was explicitly set", () => {
  assert.equal(canSkipDropboxSignVerification({ isProduction: false, isMockEsignProvider: false }), false);
});

test("canSkipDropboxSignVerification: true only outside production AND with ESIGN_PROVIDER=MOCK explicitly set", () => {
  assert.equal(canSkipDropboxSignVerification({ isProduction: false, isMockEsignProvider: true }), true);
});

// ── Full HTTP-level test against the real route ─────────────────────────────
let server: http.Server;
let baseUrl = "";
let handleEventCallCount = 0;

test.before(async () => {
  // Force the vulnerable configuration this bug required: no API key set.
  delete process.env.DROPBOX_SIGN_API_KEY;
  process.env.NODE_ENV = "production";
  delete process.env.ESIGN_PROVIDER;

  const { handleDropboxSignWebhook } = await import("../controllers/dropboxSignWebhook.controller");
  const webhookServiceModule = await import("../services/dropboxSignWebhook.service");
  const originalHandleEvent = webhookServiceModule.dropboxSignWebhookService.handleEvent;
  webhookServiceModule.dropboxSignWebhookService.handleEvent = async (event: any) => {
    handleEventCallCount += 1;
    return originalHandleEvent.call(webhookServiceModule.dropboxSignWebhookService, event);
  };

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.post("/webhooks/dropbox-sign", handleDropboxSignWebhook as any);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to start test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("SECURITY: a fabricated event with no API key configured in production is rejected with 503 and never reaches the contract-updating service", async () => {
  const fakeEvent = {
    event: { event_type: "signature_request_all_signed" },
    signature_request: { signature_request_id: "forged-request-id", signatures: [] },
  };
  const body = new URLSearchParams({ json: JSON.stringify(fakeEvent) });

  const res = await fetch(`${baseUrl}/webhooks/dropbox-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  assert.equal(res.status, 503, "must fail closed, not silently accept an unverified event");
  assert.equal(handleEventCallCount, 0, "the contract-updating service must never be invoked for an unverified event");
});
