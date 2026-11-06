/**
 * LIVE Nova Pro Converse IO for the measured warmup. Only the session constructs it, and only after every owner gate:
 * signed configuration with a Nova scope, clean pinned checkout, installed trust root + Ed25519 approval, and an
 * unused OWNER_SIGNED ledger issue whose explicit scope equals the signed configuration. Until all of these exist
 * the session stops before any ledger claim, credential resolution or request. No env flag or CLI flag unlocks it.
 */
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { NovaScopeSchema, PilotError } from "./config";
import { createNovaTransport, NOVA_MODEL, NOVA_REGION } from "./nova-converse-transport";
import { installNovaHttpBoundary, type NovaHttpAuthorization, type NovaHttpSessionBinding } from "./nova-http-boundary";
import { NOVA_ENDPOINT, assertNovaEndpointEnvironment } from "./nova-endpoint";
import type { NovaStaticCredentials } from "./nova-credentials";

export type NovaSend = (input: ConverseCommandInput, signal: AbortSignal, authorization?: NovaHttpAuthorization) => Promise<ConverseCommandOutput>;

/**
 * Dedicated client: fixed regional endpoint and PRE-resolved credentials. Never resolves or refreshes a provider.
 */
export function createNovaRuntimeClient(profile: string, credentials?: NovaStaticCredentials) {
  if (!NovaScopeSchema.shape.awsProfile.safeParse(profile).success) throw new PilotError("NOVA_PROFILE_INVALID");
  assertNovaEndpointEnvironment();
  if (!credentials?.accessKeyId || !credentials.secretAccessKey || !credentials.sessionToken || !Number.isFinite(credentials.expiration?.getTime())) throw new PilotError("NOVA_PRE_RESOLVED_CREDENTIALS_REQUIRED");
  return new BedrockRuntimeClient({ region: NOVA_REGION, endpoint: NOVA_ENDPOINT, credentials: { ...credentials, expiration: new Date(credentials.expiration) },
    maxAttempts: 1, useFipsEndpoint: false, useDualstackEndpoint: false, ignoreConfiguredEndpointUrls: true,
    // SigV4 only: a shared-config auth_scheme_preference or bearer token must not select httpBearerAuth.
    authSchemePreference: ["sigv4"] });
}
export function novaRuntimeSend(client: BedrockRuntimeClient, binding: NovaHttpSessionBinding): NovaSend {
  const boundary = installNovaHttpBoundary(client, binding);
  return async (input, signal, authorization) => boundary.run(input, signal, authorization,
    frozenInput => client.send(new ConverseCommand(frozenInput), { abortSignal: signal }));
}
type SdkError = { name?: string; message?: unknown; $fault?: string; $metadata?: { httpStatusCode?: number; requestId?: string } };
export function createLiveNovaTransport(send: NovaSend) {
  if (typeof send !== "function") throw new PilotError("NOVA_IO_REQUIRED");
  return createNovaTransport({ async converse(request, signal, authorization) {
    const input = JSON.parse(request.body) as ConverseCommandInput;
    if (request.region !== NOVA_REGION || input.modelId !== NOVA_MODEL) throw new PilotError("NOVA_TARGET_MISMATCH");
    try {
      const { $metadata, ...body } = await send(input, signal, authorization);
      return { status: $metadata?.httpStatusCode ?? 200, body: { ...body, requestId: $metadata?.requestId ?? null } };
    } catch (e) {
      const err = e as SdkError;
      // Deadline/abort keeps its own category; the session treats it as an unknown outcome.
      if (signal.aborted || err.name === "AbortError" || e instanceof PilotError) throw e;
      // Keep only bounded, non-credential error facts; the session redacts again before persistence.
      return { status: err.$metadata?.httpStatusCode ?? 0, body: { error: { name: String(err.name ?? "Error").slice(0, 100), message: String(err.message ?? "").slice(0, 500), fault: err.$fault ?? null }, requestId: err.$metadata?.requestId ?? null } };
    }
  } }, "LIVE");
}
