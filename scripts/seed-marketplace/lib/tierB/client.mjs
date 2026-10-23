// HTTP access to the gateway for Tier B. Real fetch by default; `fetchImpl` can be a fake (unit tests) and `dryRun` records
// requests without sending any. Tokens are cached per e-mail. The password and tokens are never logged (see redact()).
export class GatewayError extends Error {
  constructor(message, res) {
    super(message);
    this.name = "GatewayError";
    this.status = res?.status;
    this.body = res?.json;
  }
}

const SECRET_KEYS = /pass|token|secret|authorization|hash/i;
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v)]));
  return value;
}

export function makeClient({ baseUrl = "http://localhost:3000", fetchImpl = globalThis.fetch, dryRun = false, password, defaultHeaders = {} } = {}) {
  const tokens = new Map();
  const log = []; // request log (method, path, status) - for reports and tests; bodies are NOT kept
  let dryCounter = 0;

  async function call(method, path, { token, body, headers = {}, form, expect } = {}) {
    log.push({ method, path });
    if (dryRun) {
      dryCounter++;
      return { status: 200, json: { dryRun: true, id: `dry-${dryCounter}` }, dry: true };
    }
    const h = { ...defaultHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      h["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetchImpl(baseUrl + path, { method, headers: h, body: payload, redirect: "manual" });
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 2000) };
    }
    const out = { status: res.status, json, headers: res.headers, location: res.headers?.get?.("location") ?? null };
    log[log.length - 1].status = res.status;
    if (expect && !expect.includes(res.status)) {
      const code = json?.error?.code ?? json?.code ?? "";
      throw new GatewayError(`${method} ${path} -> ${res.status} ${code} ${json?.error?.message ?? json?.message ?? (typeof json?.error === "string" ? json.error : "")}`.trim(), out);
    }
    return out;
  }

  async function login(email) {
    if (tokens.has(email)) return tokens.get(email);
    if (dryRun) return `dry-token-${email}`;
    const r = await call("POST", "/auth/login", { body: { email, password }, expect: [200] });
    const t = r.json?.accessToken ?? r.json?.data?.accessToken;
    if (!t) throw new GatewayError(`login for ${email} returned no accessToken`, r);
    tokens.set(email, t);
    return t;
  }
  const forget = (email) => tokens.delete(email);
  const preset = (email, token) => tokens.set(email, token);

  return { call, login, forget, preset, log, baseUrl, dryRun };
}

export const unwrap = (r) => (r?.json && typeof r.json === "object" && "data" in r.json && !Array.isArray(r.json) ? r.json.data : r?.json);

/** POST a presigned-POST target (S3/MinIO): fields first, file last. */
export async function postToStorage(client, target, bytes, contentType, fetchImpl = globalThis.fetch) {
  if (client.dryRun) return 204;
  const form = new FormData();
  for (const [k, v] of Object.entries(target.fields ?? {})) form.append(k, v);
  form.append("file", new Blob([bytes], { type: contentType }), "photo");
  const res = await fetchImpl(target.url, { method: "POST", body: form });
  if (res.status >= 300) throw new GatewayError(`storage POST -> ${res.status}`, { status: res.status });
  return res.status;
}
/** PUT to a presigned URL (PT application documents). */
export async function putToStorage(client, url, bytes, contentType, fetchImpl = globalThis.fetch) {
  if (client.dryRun) return 200;
  const res = await fetchImpl(url, { method: "PUT", body: bytes, headers: { "content-type": contentType } });
  if (res.status >= 300) throw new GatewayError(`storage PUT -> ${res.status}`, { status: res.status });
  return res.status;
}
