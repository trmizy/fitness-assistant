import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import jsQR from "jsqr";
import { XIcon as X, CircleNotchIcon as Loader2, CheckCircleIcon as CheckCircle2, XCircleIcon as XCircle, CameraIcon as Camera } from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import type { CheckinResult } from "../../types";

const ERR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN: "Mã QR không hợp lệ. Hãy quét đúng mã tại quầy lễ tân.",
  TOKEN_EXPIRED: "Mã QR của phòng gym đã hết hạn — báo nhân viên tạo lại.",
  NO_MEMBERSHIP: "Bạn chưa có gói thành viên tại phòng gym này.",
  NOT_ACTIVE: "Gói thành viên của bạn không còn hiệu lực.",
  VISIT_LIMIT_REACHED: "Bạn đã dùng hết số lượt của gói.",
  TOO_SOON: "Bạn vừa check-in xong.",
};

/**
 * Member-side scanner: reads the gym's front-desk QR and records the visit, then shows a
 * confirmation card the member holds up for the receptionist.
 *
 * Decodes with jsQR over canvas frames rather than the native BarcodeDetector, which only
 * exists on Android/ChromeOS and silently never fires on most desktop browsers.
 */
export function CheckinScanModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  // Android Back closes the scanner (and releases the camera) rather than navigating away
  // with it still running.
  useBackDismissible(true, onClose);
  const [camError, setCamError] = useState("");
  const [errorText, setErrorText] = useState("");
  const [scanning, setScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // jsQR re-reads the same frame many times a second — one request per scan, not per frame.
  const busyRef = useRef(false);

  const stopCamera = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const checkIn = useMutation({
    mutationFn: (token: string) => gymService.checkInByScan(token),
    onSuccess: () => {
      stopCamera(); // done — the camera has nothing left to do
      queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
    },
    onError: (err: any) => {
      const code = err?.response?.data?.error?.code;
      setErrorText(
        ERR_MESSAGES[code] || err?.response?.data?.error?.message || "Check-in thất bại.",
      );
      // Let the member re-aim and try again instead of dead-ending.
      setTimeout(() => {
        busyRef.current = false;
      }, 2500);
    },
  });

  const tick = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "dontInvert",
    });

    if (code?.data && !busyRef.current) {
      busyRef.current = true;
      setErrorText("");
      checkIn.mutate(code.data.trim());
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startCamera = async () => {
    setCamError("");
    setErrorText("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setCamError(
        e?.name === "NotAllowedError"
          ? "Bạn đã từ chối quyền camera. Hãy cho phép trong cài đặt rồi thử lại."
          : "Không mở được camera trên thiết bị này.",
      );
    }
  };

  // Open the camera as soon as the sheet appears, and always release it on close.
  useEffect(() => {
    startCamera();
    return stopCamera; // eslint-disable-line react-hooks/exhaustive-deps
  }, []);

  const result = checkIn.data as CheckinResult & {
    clientName?: string | null;
    gymName?: string | null;
    planName?: string | null;
    endDate?: string | null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800/60 flex items-center justify-between">
          <h3 className="text-zinc-100 font-bold">
            {result ? "Check-in thành công" : "Quét mã tại phòng gym"}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success: this is the screen the receptionist reads. */}
        {result ? (
          <div className="p-5 space-y-4">
            <div className="flex flex-col items-center gap-2 py-2">
              <CheckCircle2 className="w-14 h-14 text-green-400" />
              <div className="text-lg font-bold text-zinc-100">
                {result.clientName || "Hội viên"}
              </div>
              {result.gymName && (
                <div className="text-xs text-zinc-500">{result.gymName}</div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-800/60 bg-zinc-800/30 divide-y divide-zinc-800/60 text-sm">
              {result.planName && (
                <Row label="Gói tập" value={result.planName} />
              )}
              <Row
                label="Lượt đã dùng"
                value={
                  result.totalVisits != null
                    ? `${result.usedVisits}/${result.totalVisits}`
                    : `${result.usedVisits} · không giới hạn`
                }
              />
              {result.endDate && (
                <Row
                  label="Hạn thẻ"
                  value={new Date(result.endDate).toLocaleDateString("vi-VN")}
                />
              )}
              <Row
                label="Thời gian vào"
                value={new Date(result.checkedInAt).toLocaleTimeString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
            </div>

            <p className="text-xs text-zinc-500 text-center">
              Đưa màn hình này cho nhân viên lễ tân xác nhận.
            </p>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-lg bg-green-500 hover:bg-green-400 text-black text-sm font-bold transition-colors"
            >
              Xong
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
              {scanning && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-44 h-44 border-2 border-green-400/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
              )}
              {checkIn.isPending && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
                </div>
              )}
            </div>

            <p className="text-xs text-zinc-500 text-center">
              Đưa camera vào mã QR đặt tại quầy lễ tân.
            </p>

            {camError && (
              <div className="space-y-2">
                <p className="text-xs text-red-400">{camError}</p>
                <button
                  onClick={startCamera}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-700/60 text-zinc-300 text-xs hover:bg-zinc-800 transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" /> Thử lại camera
                </button>
              </div>
            )}

            {errorText && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {errorText}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-sm font-semibold text-zinc-200">{value}</span>
    </div>
  );
}
