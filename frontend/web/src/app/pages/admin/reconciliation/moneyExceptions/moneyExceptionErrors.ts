/**
 * D7 - one place that turns a failed money-exception request into `{code, kind, message, fields, ...}`.
 *
 * Transport (axios error -> status/body, network, session change) is read here (the same shapes as the D1 parser, kept local so a change in the
 * dispute screens cannot change what a money screen says); the SENTENCE comes only from `moneyExceptionText`: a code that is not in the table never shows the server's text or the raw code, it shows a
 * generic sentence for its HTTP class (no English, no enum reaches the user).
 */
import { GENERIC_BY_KIND, REASON_TEXT, reasonText, type ReasonKind } from "./moneyExceptionText";

export interface MoneyErrorView {
  code: string | null;
  kind: ReasonKind;
  message: string;
  status: number | null;
  fields: Array<{ path: string; message: string }>;
  details: Record<string, unknown> | null;
  /** A write whose result we do not know (no answer / 5xx): reload before anything else, never resend blindly. */
  outcomeUnknown: boolean;
  /** Reload the state first: it moved under us (stale), or the result is unknown. */
  mustReload: boolean;
  /** Nothing was written and trying again is safe (the ledger could not be read). */
  canRetry: boolean;
}

const NETWORK_WRITE = "Chưa biết thao tác đã được ghi hay chưa vì không nhận được phản hồi. Hãy tải lại trạng thái để kiểm tra trước khi thử lại.";
const NETWORK_READ = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
const UNKNOWN_SUFFIX = " Chưa rõ thao tác đã được ghi hay chưa: hãy tải lại trạng thái để kiểm tra trước khi thử lại.";

function kindOfStatus(status: number | null): ReasonKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 400 || status === 422) return "validation";
  if (status === 503) return "unavailable";
  if (status === 409) return "blocked";
  return "unknown";
}

interface Transport {
  status: number | null;
  code: string | null;
  details: Record<string, unknown> | null;
  fields: Array<{ path: string; message: string }>;
  sessionChanged: boolean;
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** user-service `{error, code, details?, fields?}`; gateway / payment `{success:false, error:{code, message}}`; no response = network. */
function readTransport(error: unknown): Transport {
  const e = error as { response?: { status?: number; data?: unknown }; name?: string; message?: string } | null | undefined;
  if (e?.name === "SessionChangedError") return { status: null, code: null, details: null, fields: [], sessionChanged: true };
  if (e?.name === "Error" && e.message === "INVALID_IDEMPOTENCY_KEY") return { status: 400, code: "INVALID_IDEMPOTENCY_KEY", details: null, fields: [], sessionChanged: false };
  if (!e?.response || typeof e.response.status !== "number") return { status: null, code: null, details: null, fields: [], sessionChanged: false };
  const root = rec(e.response.data);
  let code: string | null = null;
  if (root) {
    const inner = rec(root.error);
    if (inner && typeof inner.code === "string") code = inner.code;
    if (typeof root.code === "string") code = root.code;
  }
  const fields = Array.isArray(root?.fields)
    ? (root!.fields as unknown[]).map(rec).filter((f): f is Record<string, unknown> => !!f).map((f) => ({ path: String(f.path ?? ""), message: String(f.message ?? "") }))
    : [];
  return { status: e.response.status, code, details: rec(root?.details), fields, sessionChanged: false };
}

export function parseMoneyError(error: unknown, options: { action?: "read" | "write" } = {}): MoneyErrorView {
  const write = options.action === "write";
  const t = readTransport(error);
  if (t.sessionChanged) {
    return { code: null, kind: "auth", message: "Phiên đăng nhập đã thay đổi. Hãy tải lại trang.", status: null, fields: [], details: null, outcomeUnknown: write, mustReload: true, canRetry: false };
  }
  if (t.status === null) {
    return { code: null, kind: "unknown", message: write ? NETWORK_WRITE : NETWORK_READ, status: null, fields: [], details: null, outcomeUnknown: write, mustReload: write, canRetry: !write };
  }
  const entry = t.code ? REASON_TEXT[t.code] : undefined;
  const kind: ReasonKind = entry?.kind ?? kindOfStatus(t.status);
  let message = reasonText(t.code) ?? GENERIC_BY_KIND[kind];
  const outcomeUnknown = write && t.status >= 500 && t.status !== 503;
  if (outcomeUnknown && !entry) message = `${message}${UNKNOWN_SUFFIX}`;
  const mustReload = outcomeUnknown || kind === "stale" || (t.status === 409 && t.code !== "IDEMPOTENCY_KEY_REUSED" && kind !== "disabled");
  const canRetry = kind === "unavailable" && !outcomeUnknown;
  return { code: t.code, kind, message, status: t.status, fields: t.fields, details: t.details, outcomeUnknown, mustReload, canRetry };
}

/** { fieldName: message } from a 400 `fields[]` (the server's own text, shown only when it is Vietnamese; else a neutral one). */
export function fieldErrorsOf(view: MoneyErrorView): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of view.fields) {
    if (!f.path || out[f.path]) continue;
    out[f.path.split(".")[0]] = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i.test(f.message) ? f.message : "Giá trị này chưa hợp lệ.";
  }
  return out;
}
