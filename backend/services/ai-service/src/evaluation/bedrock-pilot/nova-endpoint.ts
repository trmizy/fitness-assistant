import { PilotError } from "./config";

// Deliberately one regional endpoint; no Global, FIPS, dual-stack, PrivateLink or configured endpoint fallback.
export const NOVA_ENDPOINT = "https://bedrock-runtime.us-east-1.amazonaws.com";
export const NOVA_HOST = "bedrock-runtime.us-east-1.amazonaws.com";
export function assertNovaEndpointEnvironment(): void {
  if (["AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_BEDROCK_RUNTIME", "AWS_ENDPOINT_URL_STS"].some(k => !!process.env[k]) ||
      ["AWS_USE_FIPS_ENDPOINT", "AWS_USE_DUALSTACK_ENDPOINT"].some(k => process.env[k] && process.env[k] !== "false")) {
    throw new PilotError("NOVA_ENDPOINT_OVERRIDE_FORBIDDEN");
  }
}
export function assertNovaProfileEndpoint(profile: Record<string, string | undefined>): void {
  if (profile.endpoint_url || profile.services ||
      [profile.use_fips_endpoint, profile.use_dualstack_endpoint].some(v => v && v !== "false")) throw new PilotError("NOVA_ENDPOINT_OVERRIDE_FORBIDDEN");
}
export function assertNovaHttpDestination(request: { protocol: string; hostname: string; port?: number; headers: Record<string, string>; query?: unknown; username?: string; password?: string }): void {
  const hosts = Object.entries(request.headers).filter(([k]) => k.toLowerCase() === "host");
  if (request.protocol !== "https:" || request.hostname !== NOVA_HOST || (request.port !== undefined && request.port !== 443) ||
      request.username || request.password || Object.keys(request.query ?? {}).length ||
      hosts.length !== 1 || ![NOVA_HOST, NOVA_HOST + ":443"].includes(hosts[0][1])) throw new PilotError("NOVA_HTTP_ENDPOINT_MISMATCH");
}
