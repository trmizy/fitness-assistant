import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { CircleNotchIcon as Loader2, EnvelopeSimpleIcon as Mail, ArrowRightIcon as ArrowRight, BuildingsIcon as Buildings } from "@phosphor-icons/react";
import { friendlyError, partnerApplyPublic } from "../../services/partnerApplication";
import { PartnerApplyShell } from "./PartnerApplyShell";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Bước 1 — nhập email. Sau khi gửi, trang chuyển sang trạng thái "kiểm tra email" (có gửi lại / đổi email). */
export function PartnerApplyPage() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const start = useMutation({
    mutationFn: (addr: string) => partnerApplyPublic.start(addr),
    onSuccess: (res, addr) => {
      setError(null);
      setSentTo(addr);
      setDevLink(res.devVerifyLink ?? null);
      setCooldown(60);
    },
    onError: (e) => {
      const f = friendlyError(e, "Không gửi được email. Vui lòng thử lại.");
      setError({ message: f.message, code: f.code });
      if (f.retryAfterSeconds) setCooldown(f.retryAfterSeconds);
    },
  });

  const valid = EMAIL_RE.test(email.trim());
  const submit = () => {
    if (!valid || start.isPending || cooldown > 0) return;
    start.mutate(email.trim().toLowerCase());
  };

  if (sentTo) {
    return (
      <PartnerApplyShell>
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <Mail className="w-6 h-6 text-green-400" />
          </div>
          <h1 className="text-lg font-bold text-zinc-100">Kiểm tra email của bạn</h1>
          <p className="text-sm text-zinc-400">
            Chúng tôi đã gửi liên kết xác minh tới <span className="text-zinc-200 font-semibold break-all">{sentTo}</span>. Liên kết có hiệu lực trong 24 giờ.
          </p>
          <p className="text-xs text-zinc-600">Không thấy thư? Hãy kiểm tra mục thư rác.</p>
        </div>

        {devLink && (
          <a href={devLink} className="block rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-300">
            Chế độ thử nghiệm — mở liên kết xác minh
          </a>
        )}
        {error && <p className="text-xs text-red-400 text-center">{error.message}</p>}

        <div className="space-y-2">
          <button
            onClick={() => start.mutate(sentTo)}
            disabled={cooldown > 0 || start.isPending}
            className="w-full py-2.5 rounded-lg border border-zinc-700 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-50 transition-colors"
          >
            {start.isPending ? "Đang gửi..." : cooldown > 0 ? `Gửi lại sau ${cooldown}s` : "Gửi lại email"}
          </button>
          <button
            onClick={() => {
              setSentTo(null);
              setDevLink(null);
              setError(null);
            }}
            className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            Dùng email khác
          </button>
        </div>
      </PartnerApplyShell>
    );
  }

  return (
    <PartnerApplyShell>
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
          <Buildings className="w-6 h-6 text-green-400" />
        </div>
        <h1 className="text-lg font-bold text-zinc-100">Đăng ký làm đối tác phòng tập</h1>
        <p className="text-sm text-zinc-400">Nhập email để bắt đầu. Chúng tôi sẽ gửi liên kết xác minh, sau đó bạn tạo mật khẩu và hoàn thiện hồ sơ.</p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor="apply-email" className="text-xs text-zinc-500 mb-1.5 block">
            Email liên hệ
          </label>
          <input
            id="apply-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="ban@congty.vn"
            className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300 space-y-1.5">
            <p>{error.message}</p>
            {error.code === "EMAIL_ALREADY_PARTNER" && (
              <Link to="/login" className="inline-flex items-center gap-1 text-green-400 hover:text-green-300 font-semibold">
                Đăng nhập để tiếp tục <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={!valid || start.isPending || cooldown > 0}
          className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
        >
          {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {cooldown > 0 ? `Thử lại sau ${cooldown}s` : "Gửi liên kết xác minh"}
        </button>
      </form>
    </PartnerApplyShell>
  );
}
