import { useEffect, useState } from "react";

const API = (import.meta as any).env?.VITE_API_URL || "http://localhost:3000";

function docFilename(url?: string | null): string | null {
  if (!url) return null;
  const name = url.split("?")[0].split("/").pop();
  return name || null;
}

async function fetchDocBlob(url?: string | null): Promise<string | null> {
  const filename = docFilename(url);
  if (!filename) return null;
  const token = localStorage.getItem("accessToken");
  const res = await fetch(`${API}/pt-applications/documents/${encodeURIComponent(filename)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

/**
 * Renders a PT-application document (CCCD / portrait / certificate) fetched through the
 * AUTHENTICATED endpoint as a blob — the file is never loaded from a public URL, so ID
 * documents are only visible to the owner or an admin.
 */
export function AuthedDocImage({ url, alt, className }: { url?: string | null; alt?: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "error" | "empty">(url ? "loading" : "empty");

  useEffect(() => {
    if (!url) { setState("empty"); return; }
    let cancelled = false;
    let obj = "";
    setState("loading");
    fetchDocBlob(url)
      .then((b) => {
        if (cancelled) { if (b) URL.revokeObjectURL(b); return; }
        if (b) { obj = b; setBlobUrl(b); setState("ok"); } else setState("error");
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [url]);

  if (state === "empty") return null;
  if (state === "loading")
    return <div className={className} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><span className="text-[10px] text-zinc-500">Đang tải…</span></div>;
  if (state === "error")
    return <div className={className} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><span className="text-[10px] text-red-400">Không tải được</span></div>;
  return <img src={blobUrl} alt={alt} className={className} />;
}

/** Fetches a document as a blob and opens it in a new tab (click-to-expand / download). */
export async function openAuthedDoc(url?: string | null): Promise<void> {
  const b = await fetchDocBlob(url).catch(() => null);
  if (b) window.open(b, "_blank");
}
