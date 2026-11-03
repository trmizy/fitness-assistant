/**
 * LIVE Nova Pro Converse IO for the measured warmup. Only the session constructs it, and only after the signed
 * configuration, pinned inputs, installed trust root and owner-issued ledger checks. Execution is still locked:
 * NOVA_LIVE_EXECUTION_LOCKED stops the session before any ledger claim, credential resolution or request.
 * Lifting the lock is a separate, explicitly authorized change; no env flag or config value can lift it.
 */
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { PilotError } from "./config";
import { createNovaTransport, NOVA_MODEL, NOVA_REGION } from "./nova-converse-transport";

export const NOVA_LIVE_EXECUTION_LOCKED = true as const;
/** Owner-selected evaluation profile. Not a production credential default. */
export const NOVA_AWS_PROFILE = "divuzha";
export type NovaSend = (input: ConverseCommandInput, signal: AbortSignal) => Promise<ConverseCommandOutput>;

/** Dedicated client: fixed Region, pinned profile (explicit profile skips environment keys), SDK retries disabled. */
export function createNovaRuntimeClient() {
  return new BedrockRuntimeClient({ region: NOVA_REGION, credentials: defaultProvider({ profile: NOVA_AWS_PROFILE }), maxAttempts: 1 });
}
export function novaRuntimeSend(client = createNovaRuntimeClient()): NovaSend {
  return (input, signal) => client.send(new ConverseCommand(input), { abortSignal: signal });
}
type SdkError = { name?: string; message?: unknown; $fault?: string; $metadata?: { httpStatusCode?: number; requestId?: string } };
export function createLiveNovaTransport(send: NovaSend = novaRuntimeSend()) {
  if (typeof send !== "function") throw new PilotError("NOVA_IO_REQUIRED");
  return createNovaTransport({ async converse(request, signal) {
    const input = JSON.parse(request.body) as ConverseCommandInput;
    if (request.region !== NOVA_REGION || input.modelId !== NOVA_MODEL) throw new PilotError("NOVA_TARGET_MISMATCH");
    try {
      const { $metadata, ...body } = await send(input, signal);
      return { status: $metadata?.httpStatusCode ?? 200, body: { ...body, requestId: $metadata?.requestId ?? null } };
    } catch (e) {
      const err = e as SdkError;
      // Deadline/abort keeps its own category; the session treats it as an unknown outcome.
      if (signal.aborted || err.name === "AbortError") throw e;
      // Keep only bounded, non-credential error facts; the session redacts again before persistence.
      return { status: err.$metadata?.httpStatusCode ?? 0, body: { error: { name: String(err.name ?? "Error").slice(0, 100), message: String(err.message ?? "").slice(0, 500), fault: err.$fault ?? null }, requestId: err.$metadata?.requestId ?? null } };
    }
  } }, "LIVE");
}
