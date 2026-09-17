/**
 * A stub HTTP layer for the service tests.
 *
 * The point of these tests is the seam between our service objects and the real backend contract,
 * so everything above the wire stays real: the exported `api` instance, its baseURL, its request
 * and response interceptors, axios's own parameter and body handling. Only the adapter — the part
 * that would open a socket — is replaced.
 *
 * Each request is recorded exactly as axios would have sent it, and the handler decides the reply,
 * including error replies, which are rejected as genuine AxiosErrors so the interceptors see what
 * they would see against the real gateway.
 */
import { AxiosError } from "axios";

import { api } from "../../api";

export type RecordedRequest = {
  method: string;
  /** The path as the service wrote it, query string included. */
  url: string;
  /** Path without the query string, for readable assertions. */
  path: string;
  query: Record<string, string>;
  body: any;
  headers: Record<string, any>;
  timeout?: number;
};

export type StubReply = { status?: number; data?: any };

export type HttpStub = {
  calls: RecordedRequest[];
  last: () => RecordedRequest;
  restore: () => void;
};

function record(config: any): RecordedRequest {
  const rawUrl = String(config.url ?? "");
  const [path, search = ""] = rawUrl.split("?");
  const query: Record<string, string> = {};
  new URLSearchParams(search).forEach((value, key) => {
    query[key] = value;
  });
  // axios serialises a plain object body to a JSON string before the adapter runs; FormData and
  // other stream-ish bodies are passed through untouched.
  let body = config.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      /* leave it as the string axios produced */
    }
  }
  return {
    method: String(config.method ?? "get").toUpperCase(),
    url: rawUrl,
    path,
    query,
    body,
    headers: config.headers ?? {},
    timeout: config.timeout,
  };
}

/**
 * Install the stub. `handler` returns the reply for each request; anything with a status outside
 * 2xx is rejected the way axios rejects a real failed response.
 */
export function stubHttp(handler: (req: RecordedRequest) => StubReply): HttpStub {
  const original = api.defaults.adapter;
  const calls: RecordedRequest[] = [];

  api.defaults.adapter = async (config: any) => {
    const req = record(config);
    calls.push(req);
    const reply = handler(req) ?? {};
    const status = reply.status ?? 200;
    const response = {
      data: reply.data,
      status,
      statusText: String(status),
      headers: {},
      config,
    };
    if (status >= 200 && status < 300) return response as any;
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status === 404 ? "ERR_BAD_REQUEST" : "ERR_BAD_RESPONSE",
      config,
      null,
      response as any,
    );
  };

  return {
    calls,
    last: () => calls[calls.length - 1],
    restore: () => {
      api.defaults.adapter = original;
    },
  };
}
