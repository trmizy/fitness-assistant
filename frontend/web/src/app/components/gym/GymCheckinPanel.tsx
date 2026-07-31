import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QrCode, Camera, CameraOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { gymService } from "../../services/api";
import type { CheckinResult, GymCheckIn } from "../../types";

const ERR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN: "Mã không hợp lệ.",
  TOKEN_EXPIRED: "Mã đã hết hạn — nhờ hội viên làm mới mã.",
  WRONG_GYM: "Mã này không thuộc phòng gym của bạn.",
  MEMBERSHIP_NOT_FOUND: "Không tìm thấy gói thành viên.",
  NOT_ACTIVE: "Gói thành viên không còn hiệu lực.",
  VISIT_LIMIT_REACHED: "Đã dùng hết số lượt của gói.",
  TOO_SOON: "Vừa check-in xong — thử lại sau ít phút.",
};

const shortId = (id: string) => `${id.slice(0, 8)}…`;
const timeAgo = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

export function GymCheckinPanel({ gymId }: { gymId: string }) {
  const queryClient = useQueryClient();
  const [manual, setManual] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);

  const supportsCamera = typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices;

  const { data: checkins = [] } = useQuery<GymCheckIn[]>({
    queryKey: ["gym-checkins", gymId],
    queryFn: () => gymService.listCheckins(gymId),
  });

  const recordMutation = useMutation({
    mutationFn: (token: string) => gymService.recordCheckin(gymId, token),
    onSuccess: (r: CheckinResult) => {
      const visits = r.totalVisits != null ? ` · lượt ${r.usedVisits}/${r.totalVisits}` : "";
      setResult({ ok: true, text: `Check-in thành công: ${shortId(r.clientId)}${visits}` });
      setManual("");
      queryClient.invalidateQueries({ queryKey: ["gym-checkins", gymId] });
      queryClient.invalidateQueries({ queryKey: ["owner-gym-memberships", gymId] });
    },
    onError: (err: any) => {
      const code = err?.response?.data?.error?.code;
      setResult({ ok: false, text: ERR_MESSAGES[code] || err?.response?.data?.error?.message || "Check-in thất bại." });
    },
  });

  const stopCamera = () => {
    if (loopRef.current) { window.clearInterval(loopRef.current); loopRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const startCamera = async () => {
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      loopRef.current = window.setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes?.length) {
            const value = codes[0].rawValue as string;
            stopCamera();
            recordMutation.mutate(value);
          }
        } catch {
          /* transient detect errors are ignored */
        }
      }, 500);
    } catch {
      setResult({ ok: false, text: "Không mở được camera. Hãy nhập mã thủ công bên dưới." });
      setScanning(false);
    }
  };

  useEffect(() => stopCamera, []); // stop camera on unmount

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <QrCode className="w-5 h-5 text-green-400" />
        <h2 className="text-sm font-bold text-zinc-200">Check-in hội viên</h2>
      </div>

      {supportsCamera ? (
        <div className="space-y-2">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-w-sm">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            {!scanning && (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs">Camera đang tắt</div>
            )}
          </div>
          <button
            type="button"
            onClick={scanning ? stopCamera : startCamera}
            className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
          >
            {scanning ? <><CameraOff className="w-3.5 h-3.5" /> Tắt camera</> : <><Camera className="w-3.5 h-3.5" /> Quét bằng camera</>}
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">Trình duyệt không hỗ trợ quét camera — dùng ô nhập mã bên dưới.</p>
      )}

      <div className="flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Dán/nhập mã check-in của hội viên"
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
        />
        <button
          type="button"
          onClick={() => manual.trim() && recordMutation.mutate(manual.trim())}
          disabled={recordMutation.isPending || !manual.trim()}
          className="flex items-center gap-1.5 border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
        >
          {recordMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Check-in
        </button>
      </div>

      {result && (
        <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${result.ok ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {result.text}
        </div>
      )}

      <div>
        <div className="text-[11px] text-zinc-600 uppercase tracking-wide mb-2">Check-in gần đây</div>
        {checkins.length === 0 ? (
          <div className="text-xs text-zinc-600">Chưa có lượt check-in nào.</div>
        ) : (
          <div className="space-y-1">
            {checkins.slice(0, 8).map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-800/40 rounded px-2.5 py-1.5">
                <span>{shortId(c.clientId)}</span>
                <span className="text-zinc-600">{timeAgo(c.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
