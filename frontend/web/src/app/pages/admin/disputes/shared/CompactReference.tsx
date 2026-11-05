import { useState } from "react";
import { REFERENCE_KIND_LABEL } from "../disputeCaseLabels";

/** Reference shape for formatting display without leaking raw enum strings. */
export interface DisplayedReferenceParts {
  /** Vietnamese kind/type label (e.g. "Bản ghi PT chấp nhận điều khoản", "Bằng chứng", "Bút toán sổ cái") */
  kindLabel?: string;
  /** Primary identifier (UUID, key, etc.) - never starts with uppercase enum token */
  id: string;
  /** Short form of primary identifier (first 8 chars + ellipsis) */
  shortId: string;
  /** Content hash if present */
  hash?: string;
  /** Short form of hash if present */
  shortHash?: string;
  /** Combined one-line display string for lists / simple views (guaranteed to not start with uppercase enum) */
  displayLabel: string;
}

/** Pure function that parses any reference input (string or object) and builds displayable parts. */
export function formatReferenceParts(
  input: string | { kind?: string; type?: string; id?: string; hash?: string; contentHash?: string; key?: string }
): DisplayedReferenceParts {
  let kind: string | undefined;
  let id = "";
  let hash: string | undefined;

  if (typeof input === "string") {
    const parts = input.split(":");
    if (parts.length >= 2 && (parts[0] in REFERENCE_KIND_LABEL || /^[A-Z0-9_]+$/.test(parts[0]))) {
      kind = parts[0];
      id = parts[1] || "";
      if (parts.length >= 3) {
        hash = parts[2] || undefined;
      }
    } else {
      id = input;
    }
  } else if (input && typeof input === "object") {
    kind = input.kind || input.type;
    id = input.id || input.key || "";
    hash = input.hash || input.contentHash;
  }

  const kindLabel = kind ? (REFERENCE_KIND_LABEL[kind] ?? "Tham chiếu") : undefined;
  const shortId = shortenRef(id);
  const shortHash = hash ? shortenRef(hash) : undefined;
  const prefix = kindLabel ? `${kindLabel}: ` : "";
  const displayLabel = `${prefix}${shortId}`;

  return {
    kindLabel,
    id,
    shortId,
    hash,
    shortHash,
    displayLabel,
  };
}

/** Shorten an audit identifier to its first 8 chars + ellipsis. Strips enum prefixes if present. */
export function shortenRef(value: string): string {
  const parts = value.split(":");
  let identifier = value;
  if (parts.length >= 2 && (/^[A-Z0-9_]+$/.test(parts[0]) || parts[0] in REFERENCE_KIND_LABEL)) {
    identifier = parts[1] || value;
  }
  return identifier.length > 8 ? `${identifier.slice(0, 8)}…` : identifier;
}

/** Keep audit identifiers available without making hashes the primary reading surface. */
export function CompactReference({ value, label = "Mã tham chiếu" }: { value: string; label?: string }) {
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState(false);
  const parts = formatReferenceParts(value);
  const displayId = parts.id || value;
  const short = parts.shortId;

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setStatus("Đã sao chép"); }
    catch { setStatus("Chưa sao chép được. Hãy mở đầy đủ và chọn nội dung."); }
  }

  return (
    <div className="min-w-0 max-w-full space-y-1 text-xs" data-testid="compact-reference">
      {parts.kindLabel && (
        <span className="block font-medium text-adm-text-2">{parts.kindLabel}</span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono">{short}</span>
        <button type="button" onClick={() => void copy(displayId)} aria-label={`Sao chép ${label.toLowerCase()}`} className="min-h-11 rounded-md border border-current px-2 font-sans focus-visible:outline-2 focus-visible:outline-offset-2 xl:min-h-8">Sao chép</button>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="min-h-11 rounded-md border border-current px-2 font-sans focus-visible:outline-2 focus-visible:outline-offset-2 xl:min-h-8">Xem đầy đủ {label.toLowerCase()}</button>
      </div>
      <span role="status" className="block font-sans">{status}</span>
      {expanded && <code className="block break-all whitespace-pre-wrap">{displayId}</code>}
      {parts.hash && (
        <div className="pt-1">
          <CompactReference value={parts.hash} label="Mã băm" />
        </div>
      )}
    </div>
  );
}

export function isReferenceValue(value: unknown): value is string {
  return typeof value === "string" && (/^(EVIDENCE|LEDGER_OP|PT_TERMS_ACCEPTANCE|CONTRACT_AUDIT_LOG):/.test(value) || /^[a-f\d]{32,}$/i.test(value));
}
