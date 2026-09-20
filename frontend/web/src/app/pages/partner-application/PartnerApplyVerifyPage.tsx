import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon as Loader2, WarningIcon as AlertTriangle, EyeIcon as Eye, EyeSlashIcon as EyeOff, CheckCircleIcon as CheckCircle2 } from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { friendlyError, partnerApplication, partnerApplyPublic } from "../../services/partnerApplication";
import { PartnerApplyShell } from "./PartnerApplyShell";

// Phiên đặt mật khẩu chỉ sống trong tab này (sessionStorage), hết hạn sau 15 phút, xoá ngay khi đặt xong.
const SETUP_KEY = "gymini.partnerSetup";
interface SetupSession {
  email: string;
  setupToken: string;
  expiresAt: number;
}

function readSetup(): SetupSession | null {
  try {
    const raw = sessionStorage.getItem(SETUP_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SetupSession;
    return s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}
const writeSetup = (s: SetupSession) => {
  try {
    sessionStorage.setItem(SETUP_KEY, JSON.stringify(s));
  } catch {
    /* sessionStorage bị chặn: phiên chỉ sống trong bộ nhớ của trang */
  }
};
const clearSetup = () => {
  try {
    sessionStorage.removeItem(SETUP_KEY);
  } catch {
    /* noop */
  }
};

type Phase = "checking" | "ready" | "INVALID" | "EXPIRED" | "USED";

const PROBLEM_COPY: Record<"INVALID" | "EXPIRED" | "USED", { title: string; body: string }> = {
  INVALID: { title: "Liên kết không hợp lệ", body: "Liên kết này không đúng hoặc đã bị thay thế. Hãy yêu cầu một liên kết mới." },
  EXPIRED: { title: "Liên kết đã hết hạn", body: "Liên kết xác minh chỉ có hiệu lực 24 giờ. Hãy yêu cầu một liên kết mới." },
  USED: { title: "Liên kết đã được sử dụng", body: "Tài khoản đã được tạo từ liên kết này. Hãy đăng nhập để tiếp tục hồ sơ." },
};

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ["Rất yếu", "Yếu", "Trung bình", "Khá", "Mạnh"][score] };
}

/**
 * Bước 2-3 — mở link từ email: đọc token từ FRAGMENT, xoá khỏi URL/history NGAY (trước mọi lời gọi
 * API), đổi lấy setupToken ngắn hạn rồi cho đặt mật khẩu. Token email không bao giờ đi tiếp trong
 * URL hay body.
 */
export function PartnerApplyVerifyPage() {
  const navigate = useNavigate();
  const { login } = useApp();
  const started = useRef(false);

  const [phase, setPhase] = useState<Phase>("checking");
  const [setup, setSetup] = useState<SetupSession | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const token = hash.get("token") || query.get("token");

    // Xoá token khỏi thanh địa chỉ và history trước khi làm bất cứ điều gì khác.
    if (token) window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      const resumed = readSetup();
      if (resumed) {
        setSetup(resumed);
        setPhase("ready");
      } else {
        setPhase("INVALID");
      }
      return;
    }

    partnerApplyPublic
      .verify(token)
      .then((res) => {
        if (res.status === "VALID") {
          const s: SetupSession = { email: res.email, setupToken: res.setupToken, expiresAt: new Date(res.setupExpiresAt).getTime() };
          writeSetup(s);
          setSetup(s);
          setPhase("ready");
        } else {
          setPhase(res.status);
        }
      })
      .catch(() => setPhase("INVALID"));
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      if (!setup) throw new Error("Phiên đặt mật khẩu đã hết hạn");
      await partnerApplyPublic.setPassword(setup.setupToken, password);
      clearSetup();
      const ok = await login(setup.email, password);
      if (!ok) throw new Error("Không đăng nhập được sau khi tạo tài khoản");
      await partnerApplication.bootstrap();
    },
    onSuccess: () => {
      toast.success("Đã tạo tài khoản. Hãy hoàn thiện hồ sơ đối tác.");
      navigate("/partner/application", { replace: true });
    },
    onError: (e) => {
      const f = friendlyError(e, "Không tạo được tài khoản. Vui lòng thử lại.");
      if (f.status === 400 || f.status === 401 || f.status === 410) {
        // setupToken hết hạn/đã thay: cần verify lại từ link email.
        clearSetup();
        setPhase("EXPIRED");
      } else {
        setError(f.message);
      }
    },
  });

  if (phase === "checking") {
    return (
      <PartnerApplyShell>
        <div className="py-8 flex justify-center">
          <Loader2 className="w-7 h-7 text-green-500 animate-spin" />
        </div>
      </PartnerApplyShell>
    );
  }

  if (phase !== "ready" || !setup) {
    const copy = PROBLEM_COPY[phase === "ready" ? "INVALID" : phase];
    return (
      <PartnerApplyShell>
        <div className="text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold text-zinc-100">{copy.title}</h1>
          <p className="text-sm text-zinc-400">{copy.body}</p>
          <Link
            to={phase === "USED" ? "/login" : "/partner/apply"}
            className="inline-block bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-lg text-sm font-bold"
          >
            {phase === "USED" ? "Đăng nhập" : "Yêu cầu liên kết mới"}
          </Link>
        </div>
      </PartnerApplyShell>
    );
  }

  const match = password.length > 0 && password === confirm;
  const st = strength(password);
  const canSubmit = password.length >= 8 && match && !create.isPending;

  return (
    <PartnerApplyShell>
      <div className="text-center space-y-1">
        <CheckCircle2 className="w-9 h-9 text-green-400 mx-auto" />
        <h1 className="text-lg font-bold text-zinc-100">Email đã được xác minh</h1>
        <p className="text-sm text-zinc-400">
          Tạo mật khẩu cho tài khoản <span className="text-zinc-200 font-semibold break-all">{setup.email}</span>
        </p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) create.mutate();
        }}
      >
        <div>
          <label htmlFor="pw" className="text-xs text-zinc-500 mb-1.5 block">
            Mật khẩu (tối thiểu 8 ký tự)
          </label>
          <div className="relative">
            <input
              id="pw"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              className="w-full px-3 py-2.5 pr-10 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {password.length > 0 && (
            <div className="mt-1.5">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i < st.score ? (st.score >= 3 ? "bg-green-500" : "bg-amber-500") : "bg-zinc-700"}`} />
                ))}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">{st.label}</p>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="pw2" className="text-xs text-zinc-500 mb-1.5 block">
            Nhập lại mật khẩu
          </label>
          <input
            id="pw2"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
          />
          {confirm.length > 0 && !match && <p className="text-[11px] text-red-400 mt-1">Mật khẩu không khớp</p>}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
        >
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Tạo tài khoản & tiếp tục
        </button>
      </form>
    </PartnerApplyShell>
  );
}
