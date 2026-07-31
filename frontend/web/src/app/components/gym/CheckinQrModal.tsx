import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { Loader2, X, RefreshCw } from "lucide-react";
import { gymService } from "../../services/api";
import type { CheckinToken } from "../../types";

/**
 * Shows a rotating QR (of a short-lived signed token) that the gym scans to check the member in.
 * The token expires in ~2 min; we refetch + re-render shortly before it lapses. A plain-text code
 * is shown too, so the gym can type it in if their scanner/camera isn't available.
 */
export function CheckinQrModal({ membershipId, onClose }: { membershipId: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  const [tok, setTok] = useState<CheckinToken | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    setError("");
    try {
      const t: CheckinToken = await gymService.getCheckinToken(membershipId);
      setTok(t);
      setDataUrl(await QRCode.toDataURL(t.token, { width: 240, margin: 1 }));
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || "Không lấy được mã check-in");
    }
  }, [membershipId]);

  useEffect(() => {
    load();
  }, [load]);

  // Countdown; auto-refresh 5s before expiry.
  useEffect(() => {
    if (!tok) return;
    const tick = () => {
      const secs = Math.max(0, Math.round((tok.expiresAt - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 5) load();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tok, load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
          <h3 className="text-zinc-100 font-bold">Mã check-in vào gym</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 flex flex-col items-center gap-4">
          {error ? (
            <div className="text-sm text-red-400 text-center py-8">{error}</div>
          ) : !dataUrl ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
            </div>
          ) : (
            <>
              <p className="text-xs text-zinc-500 text-center">Đưa mã này cho quầy lễ tân của phòng gym để quét.</p>
              <img src={dataUrl} alt="Check-in QR" className="rounded-lg bg-white p-2" width={240} height={240} />
              <div className="text-center">
                <div className="text-[11px] text-zinc-600 uppercase tracking-wide mb-1">Mã dự phòng (nhập tay)</div>
                <code className="text-[11px] break-all text-zinc-400 bg-zinc-800/60 rounded px-2 py-1 inline-block max-w-full">
                  {tok?.token}
                </code>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>Mã tự làm mới sau {remaining}s</span>
                <button onClick={load} className="inline-flex items-center gap-1 text-green-400 hover:text-green-300">
                  <RefreshCw className="w-3 h-3" /> làm mới
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
