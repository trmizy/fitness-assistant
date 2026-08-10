import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { QrCode, Loader2, Maximize2, X, RefreshCw } from "lucide-react";
import { gymService } from "../../services/api";
import type { GymCheckIn } from "../../types";

const shortId = (id: string) => `${id.slice(0, 8)}…`;
const timeAgo = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

/**
 * The gym's front-desk check-in QR. The member scans it with their own phone, so the gym
 * needs no scanner hardware and no camera permission — and the member's identity comes
 * from their logged-in session rather than from anything encoded in this image.
 */
export function GymCheckinPanel({ gymId }: { gymId: string }) {
  const [dataUrl, setDataUrl] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  const { data: qr, isLoading, refetch, isRefetching } = useQuery<{
    token: string;
    gymName: string;
  }>({
    queryKey: ["gym-checkin-qr", gymId],
    queryFn: () => gymService.getGymCheckinQr(gymId),
  });

  const { data: checkins = [] } = useQuery<GymCheckIn[]>({
    queryKey: ["gym-checkins", gymId],
    // The desk watches this list to see arrivals appear as members scan.
    refetchInterval: 10000,
    queryFn: () => gymService.listCheckins(gymId),
  });

  useEffect(() => {
    if (!qr?.token) return;
    QRCode.toDataURL(qr.token, { width: 420, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [qr?.token]);

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-green-400" />
          <h2 className="text-sm font-bold text-zinc-200">Mã QR check-in</h2>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isRefetching ? "animate-spin" : ""}`} /> Tạo lại
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        In mã này và đặt tại quầy lễ tân. Hội viên mở app, quét mã, rồi đưa màn hình xác nhận
        cho nhân viên kiểm tra.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="relative">
          {isLoading || !dataUrl ? (
            <div className="w-[200px] h-[200px] rounded-xl bg-zinc-800/60 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
            </div>
          ) : (
            <>
              <img
                src={dataUrl}
                alt="Mã QR check-in của phòng gym"
                className="rounded-xl bg-white p-3"
                width={200}
                height={200}
              />
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-zinc-900/90 text-zinc-300 hover:text-green-400 border border-zinc-700/60"
                aria-label="Phóng to mã QR"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-zinc-600 uppercase tracking-wide mb-2">
            Check-in gần đây
          </div>
          {checkins.length === 0 ? (
            <div className="text-xs text-zinc-600">Chưa có lượt check-in nào.</div>
          ) : (
            <div className="space-y-1">
              {checkins.slice(0, 6).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-800/40 rounded px-2.5 py-1.5"
                >
                  <span>{shortId(c.clientId)}</span>
                  <span className="text-zinc-600">{timeAgo(c.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Blown up so a phone can read it from across the desk. */}
      {fullscreen && dataUrl && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-6"
          onClick={() => setFullscreen(false)}
        >
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="absolute top-5 right-5 text-zinc-400 hover:text-zinc-100"
            aria-label="Đóng"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="text-zinc-100 font-bold mb-4">{qr?.gymName}</div>
          <img
            src={dataUrl}
            alt="Mã QR check-in"
            className="rounded-2xl bg-white p-6 max-w-[80vw] max-h-[70vh]"
          />
          <p className="text-zinc-400 text-sm mt-4">Quét mã để check-in</p>
        </div>
      )}
    </div>
  );
}
