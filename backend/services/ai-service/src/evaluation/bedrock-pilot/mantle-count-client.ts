/** COUNT-only SigV4 HTTP client. No inference route; real credentials are lazy behind existing owner authority. */
import https from "node:https";
import { execFileSync } from "node:child_process";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256Node } from "@smithy/core/checksum";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { z } from "zod";
import { PilotError } from "./config";
import { installedApproval, openBudgetLedger } from "./ledger";
import { assertSeparate } from "./storage";
import { digest } from "../evaluation-kit/identity";
import { protect } from "../evaluation-kit/representation";
import { assertCleanWorkingTree, implementationRoot } from "./pins";
import { assertCountOnlyAccountReady, COUNT_ENDPOINT, parseCountOnlyProbe } from "./count-only-probe";

type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date; accountId?: string };
export interface CountSignedRequest { protocol: string; hostname: string; path: string; method: string; headers: Record<string, string>; body: string; query: Record<string, string> }
export interface CountHttpReply { status: number; body: unknown; headers?: Record<string, string> }
interface CountIo { credentials(): Promise<Credentials>; post(request: CountSignedRequest, signal: AbortSignal): Promise<CountHttpReply>; now(): Date }
export interface MockCountIo extends CountIo { kind: "MOCK" }
const Tokens = z.object({ input_tokens: z.number().int().nonnegative().safe() }).passthrough();
function scrub(value: unknown, credentials: Credentials): unknown {
  if (typeof value === "string") return [credentials.accessKeyId, credentials.secretAccessKey, credentials.sessionToken].filter((v): v is string => !!v).reduce((s, secret) => s.split(secret).join("[REDACTED]"), value);
  if (Array.isArray(value)) return value.map(v => scrub(v, credentials));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, credentials)]));
  return value;
}
function responseReceipt(reply: CountHttpReply, credentials: Credentials) {
  const headers = Object.fromEntries(Object.entries(reply.headers ?? {}).filter(([k]) => ["x-amzn-requestid", "x-amzn-request-id", "request-id", "content-type", "retry-after"].includes(k.toLowerCase())));
  return protect(scrub({ status: reply.status, body: reply.body, headers }, credentials));
}
async function once(value: unknown, io: CountIo, external?: AbortSignal, expectedAccount?: string) {
  const p = parseCountOnlyProbe(value, io.now().getTime()), controller = new AbortController();
  if (external?.aborted) throw new PilotError("COUNT_ABORTED");
  const abort = () => controller.abort(); external?.addEventListener("abort", abort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  const work = async () => {
    let credentials: Credentials;
    try { credentials = await io.credentials(); } catch { throw new PilotError("COUNT_AUTHENTICATION_FAILED"); }
    if (controller.signal.aborted) throw new PilotError("COUNT_ABORTED");
    if (credentials.expiration && credentials.expiration.getTime() <= io.now().getTime()) throw new PilotError("COUNT_CREDENTIALS_EXPIRED");
    // Static profile keys carry no account; when a provider reports one it must match the approved project account.
    if (expectedAccount && credentials.accountId && credentials.accountId !== expectedAccount) throw new PilotError("COUNT_CREDENTIAL_ACCOUNT_MISMATCH");
    const url = new URL(COUNT_ENDPOINT);
    const request: CountSignedRequest = { protocol: "https:", hostname: url.hostname, path: url.pathname, method: "POST", query: {}, body: p.request.body,
      headers: { host: url.hostname, ...p.request.headers, "content-length": String(Buffer.byteLength(p.request.body, "utf8")) } };
    let signed: CountSignedRequest;
    try { signed = await new SignatureV4({ credentials, region: "us-east-2", service: "bedrock-mantle", sha256: Sha256Node }).sign(request, { signingDate: io.now() }) as CountSignedRequest; }
    catch { throw new PilotError("COUNT_SIGNING_FAILED"); }
    // Recheck time and exact body immediately before the sole HTTP dispatch.
    parseCountOnlyProbe(p, io.now().getTime());
    if (controller.signal.aborted) throw new PilotError("COUNT_ABORTED");
    let reply: CountHttpReply;
    try { reply = await io.post(signed, controller.signal); }
    catch (e) { throw e instanceof PilotError ? e : new PilotError(controller.signal.aborted ? "COUNT_TIMEOUT" : "COUNT_NETWORK_ERROR"); }
    const response = responseReceipt(reply, credentials), fail = (code: string): never => { throw new PilotError(code, { status: reply.status, requestHash: p.request.sha256, response }); };
    if (!Number.isInteger(reply.status)) fail("COUNT_RESPONSE_INVALID");
    if (reply.status >= 300 && reply.status < 400) fail("COUNT_REDIRECT_REFUSED");
    if (reply.status < 200 || reply.status >= 300) fail(reply.status === 401 || reply.status === 403 ? "COUNT_AUTHENTICATION_ERROR" : reply.status === 429 ? "COUNT_THROTTLED" : reply.status === 400 ? "COUNT_VALIDATION_ERROR" : "COUNT_PROVIDER_ERROR");
    let body = reply.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { fail("COUNT_RESPONSE_INVALID_JSON"); } }
    if (body && typeof body === "object" && (body as { type?: string }).type === "error") fail("COUNT_PROVIDER_ERROR");
    const parsed = Tokens.safeParse(body); if (!parsed.success) return fail("COUNT_RESPONSE_INVALID");
    if (parsed.data.input_tokens > p.maxInputTokens) fail("COUNT_TOKEN_CAP_EXCEEDED");
    const requestId = Object.entries(reply.headers ?? {}).find(([k]) => ["x-amzn-requestid", "x-amzn-request-id", "request-id"].includes(k.toLowerCase()))?.[1];
    return { inputTokens: parsed.data.input_tokens, requestHash: p.request.sha256, response, status: reply.status,
      ...(requestId ? { requestId: scrub(requestId, credentials) as string } : {}) };
  };
  try { return await Promise.race([work(), new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new PilotError("COUNT_TIMEOUT")); }, p.timeoutMs);
    controller.signal.addEventListener("abort", () => { if (external?.aborted) reject(new PilotError("COUNT_ABORTED")); }, { once: true });
  })]); }
  finally { if (timer) clearTimeout(timer); external?.removeEventListener("abort", abort); }
}
/** Only a caller-supplied MOCK IO can exercise signing without installed owner authority. */
export function createMockCountOnlyClient(io: Omit<MockCountIo, "now"> & { now?: () => Date; expectedAccount?: string }) {
  if (io.kind !== "MOCK" || typeof io.credentials !== "function" || typeof io.post !== "function") throw new PilotError("COUNT_MOCK_IO_REQUIRED");
  let used = false;
  return { async count(probe: unknown, signal?: AbortSignal) {
    parseCountOnlyProbe(probe, (io.now?.() ?? new Date()).getTime());
    if (used) throw new PilotError("COUNT_PROBE_ALREADY_ATTEMPTED"); used = true;
    return once(probe, { ...io, now: io.now ?? (() => new Date()) }, signal, io.expectedAccount);
  } };
}
function nativePost(request: CountSignedRequest, signal: AbortSignal): Promise<CountHttpReply> {
  return new Promise((resolve, reject) => {
    // Fixed host/path and native HTTPS: no redirect handling, proxy/fallback or retry loop.
    const req = https.request({ protocol: "https:", hostname: "bedrock-mantle.us-east-2.api.aws", port: 443, path: "/anthropic/v1/messages/count_tokens", method: "POST", headers: request.headers, signal, agent: false }, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (part: Buffer) => { bytes += part.length; if (bytes > 65536) req.destroy(new PilotError("COUNT_RESPONSE_TOO_LARGE")); else chunks.push(part); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: Object.fromEntries(Object.entries(res.headers).filter((e): e is [string, string] => typeof e[1] === "string")) }));
      res.on("error", () => reject(new PilotError("COUNT_NETWORK_ERROR")));
    });
    req.on("error", e => reject(e instanceof PilotError ? e : new PilotError(signal.aborted ? "COUNT_TIMEOUT" : "COUNT_NETWORK_ERROR")));
    req.end(request.body, "utf8");
  });
}
/** Reviewed, committed code only: the executing checkout must be clean and at the package's implementation commit. */
export function assertImplementationCheckout(expectedCommit: string, root = implementationRoot) {
  assertCleanWorkingTree(root);
  if (execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim() !== expectedCommit) throw new PilotError("COUNT_IMPLEMENTATION_COMMIT_MISMATCH");
}
/** Only count-only-cli `execute` calls this. Preparation never resolves credentials or reaches this path. */
export async function executeAuthorizedCountOnlyProbe(value: unknown, approvalValue: unknown, options: { workspaceRoot: string; runDirectory: string }) {
  const p = parseCountOnlyProbe(value), account = assertCountOnlyAccountReady(p);
  assertImplementationCheckout(p.sourcePins.implementationCommit);
  const configHash = digest(p), trusted = installedApproval({ approval: approvalValue as Parameters<typeof installedApproval>[0]["approval"] });
  if (trusted.approval.configHash !== configHash || Date.parse(trusted.approval.expiresAt) > Date.parse(p.expiresAt)) throw new PilotError("COUNT_AUTHORIZATION_REQUEST_MISMATCH");
  assertSeparate(trusted.directory, options.workspaceRoot);
  const ledger = openBudgetLedger({ directory: trusted.directory, approvalId: trusted.approval.approvalId, approvalHash: digest(trusted.approval), configHash, runDirectory: options.runDirectory, mode: "LIVE", resume: false });
  try {
    if (ledger.state().countCalls !== 0 || ledger.state().inferenceCalls !== 0) throw new PilotError("COUNT_PROBE_ALREADY_ATTEMPTED");
    // Owner-preissued ledger only; this code never issues one. Claim the one-shot budget before credentials.
    ledger.save({ ...ledger.state(), countCalls: 1, stopped: true }, "COUNT_ONLY_RESERVED");
    // Pinned profile: with an explicit profile the default chain skips environment keys.
    let result: Awaited<ReturnType<typeof once>>;
    try { result = await once(p, { credentials: defaultProvider({ profile: p.awsProfile }), post: nativePost, now: () => new Date() }, undefined, account); }
    catch (e) { try { ledger.save({ ...ledger.state(), failures: 1 }, "COUNT_ONLY_FAILED"); } catch { /* reservation already makes the probe one-shot */ } throw e; }
    ledger.save({ ...ledger.state(), inputTokens: result.inputTokens }, "COUNT_ONLY_COMPLETED");
    return result;
  } finally { ledger.close(); }
}
