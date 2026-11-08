import type { STSClient, AssumeRoleCommandInput } from "@aws-sdk/client-sts";
import { PilotError } from "./config";
import { NOVA_STS_HOST, assertNovaEndpointEnvironment, assertNovaSigningScope, assertSingleAuthority } from "./nova-endpoint";

/** One AssumeRole only. Source key, signed request bytes and regional destination are checked at final transport. */
export function installNovaStsBoundary(client: STSClient, sourceKey: string, input: AssumeRoleCommandInput, assertCurrent: () => void) {
  const config = client.config, delegate = config.requestHandler, dispatch = delegate.handle.bind(delegate);
  const expected = new Map(Object.entries({ Action: "AssumeRole", Version: "2011-06-15", ...input }).map(([k, v]) => [k, String(v)]));
  let dispatched = false;
  const handle: typeof delegate.handle = (request, options) => {
    const headers = Object.freeze({ ...request.headers }), query = Object.freeze({ ...request.query });
    const hosts = Object.entries(headers).filter(([k]) => k.toLowerCase() === "host");
    if (client.config !== config || config.requestHandler !== guarded) throw new PilotError("NOVA_STS_HANDLER_REPLACED");
    if (request.protocol !== "https:" || request.hostname !== NOVA_STS_HOST || (request.port !== undefined && request.port !== 443) || hosts.length > 1 ||
        request.username || request.password || Object.keys(query).length || request.path !== "/" || request.method !== "POST") throw new PilotError("NOVA_STS_ENDPOINT_MISMATCH");
    assertSingleAuthority(headers, NOVA_STS_HOST);
    assertNovaSigningScope(headers, "sts", sourceKey);
    const raw = typeof request.body === "string" ? request.body : request.body instanceof Uint8Array ? Buffer.from(request.body).toString("utf8") : null;
    const fields = new URLSearchParams(raw ?? "");
    if (raw === null || [...fields].length !== expected.size || [...fields].some(([k, v]) => expected.get(k) !== v) ||
        [...expected.keys()].some(k => fields.getAll(k).length !== 1)) throw new PilotError("NOVA_STS_REQUEST_MISMATCH");
    const snapshot = Object.freeze({ ...request, headers, query, body: raw });
    assertNovaEndpointEnvironment();
    // Fail closed before dispatch: a valid authority is synchronous and returns undefined. Anything else
    // (notably a Promise from an async authority) cannot be awaited here without reserving the single dispatch,
    // so reject it. If it is a real Promise, swallow its settlement so it never surfaces as an unhandled rejection.
    const authority = (assertCurrent as () => unknown)();
    if (authority !== undefined) {
      if (authority instanceof Promise) authority.catch(() => {});
      throw new PilotError("NOVA_STS_ASYNC_AUTHORITY_FORBIDDEN");
    }
    if (dispatched) throw new PilotError("NOVA_STS_DISPATCH_REPLAY");
    dispatched = true;
    return dispatch(snapshot, options).then(result => {
      if (result.response.statusCode >= 300 && result.response.statusCode < 400) throw new PilotError("NOVA_STS_REDIRECT_FORBIDDEN");
      return result;
    });
  };
  const guarded = new Proxy(delegate, { get(target, key) {
    if (key === "handle") return handle;
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  Object.defineProperty(config, "requestHandler", { value: guarded, writable: false, configurable: false, enumerable: true });
  // Seal the client root binding so client.config cannot be swapped for an unguarded config after install.
  // The value is the same config object, kept enumerable, so SDK reads and destroy() still resolve through it.
  Object.defineProperty(client, "config", { value: config, writable: false, configurable: false, enumerable: true });
}
