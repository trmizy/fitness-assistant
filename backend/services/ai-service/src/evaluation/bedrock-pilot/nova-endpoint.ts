import { PilotError } from "./config";

// Deliberately one regional endpoint; no Global, FIPS, dual-stack, PrivateLink or configured endpoint fallback.
export const NOVA_ENDPOINT = "https://bedrock-runtime.us-east-1.amazonaws.com";
export const NOVA_HOST = "bedrock-runtime.us-east-1.amazonaws.com";
export const NOVA_STS_HOST = "sts.us-east-1.amazonaws.com";
/** Check the actual signed request, independently of SDK endpoint/configuration names. */
export function assertNovaSigningScope(headers: Record<string, string>, service: "sts" | "bedrock", key?: string): void {
  const auth = Object.entries(headers).filter(([k]) => k.toLowerCase() === "authorization");
  const match = auth.length === 1 && /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/us-east-1\/(sts|bedrock)\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(auth[0][1]);
  // HTTP/1.1 signs `host`; the production Bedrock NodeHttp2Handler replaces it with the `:authority` pseudo-header.
  const authorityHeader = Object.keys(headers).find(k => k.toLowerCase() === "host" || k === ":authority")?.toLowerCase();
  if (!match || match[3] !== service || (key !== undefined && match[1] !== key) || !authorityHeader || !match[4].split(";").includes(authorityHeader)) throw new PilotError("NOVA_SIGNING_SCOPE_MISMATCH");
}
/** Exactly one destination header, `host` (HTTP/1.1) or `:authority` (HTTP/2), naming the approved host. */
export function assertSingleAuthority(headers: Record<string, string>, host: string): void {
  const values = Object.entries(headers).filter(([k]) => k.toLowerCase() === "host" || k === ":authority").map(([, v]) => String(v));
  if (values.length !== 1 || ![host, host + ":443"].includes(values[0])) throw new PilotError(host === NOVA_HOST ? "NOVA_HTTP_ENDPOINT_MISMATCH" : "NOVA_STS_ENDPOINT_MISMATCH");
}
export function assertNovaEndpointEnvironment(): void {
  if (["AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_BEDROCK_RUNTIME", "AWS_ENDPOINT_URL_STS"].some(k => !!process.env[k]) ||
      ["AWS_USE_FIPS_ENDPOINT", "AWS_USE_DUALSTACK_ENDPOINT"].some(k => process.env[k] && process.env[k] !== "false")) {
    throw new PilotError("NOVA_ENDPOINT_OVERRIDE_FORBIDDEN");
  }
  // Bearer/API-key auth would replace SigV4 + STS; the HTTP guard would only reject it AFTER a ledger reservation.
  if (["AWS_BEARER_TOKEN_BEDROCK", "AWS_AUTH_SCHEME_PREFERENCE"].some(k => process.env[k] !== undefined)) throw new PilotError("NOVA_AUTH_OVERRIDE_FORBIDDEN");
}
export function assertNovaProfileEndpoint(profile: Record<string, string | undefined>): void {
  if (profile.endpoint_url || profile.services ||
      [profile.use_fips_endpoint, profile.use_dualstack_endpoint].some(v => v && v !== "false")) throw new PilotError("NOVA_ENDPOINT_OVERRIDE_FORBIDDEN");
}
export function assertNovaHttpDestination(request: { protocol: string; hostname: string; port?: number; headers: Record<string, string>; query?: unknown; username?: string; password?: string }): void {
  if (request.protocol !== "https:" || request.hostname !== NOVA_HOST || (request.port !== undefined && request.port !== 443) ||
      request.username || request.password || Object.keys(request.query ?? {}).length) throw new PilotError("NOVA_HTTP_ENDPOINT_MISMATCH");
  assertSingleAuthority(request.headers, NOVA_HOST);
}
