import { QuestionIcon as HelpCircle, InfoIcon as Info, ArrowSquareOutIcon as ExternalLink, CompassIcon as Compass } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { SectionCard } from "./components/SectionCard";

// Kept alongside frontend/web/package.json's "version" field — no build-time
// version injection exists in this project (checked vite.config.ts), so
// this is a plain literal rather than inventing a new bundling mechanism
// for one string. Bump it if package.json's version changes.
const APP_VERSION = "0.0.1";

const FAQ = [
  {
    q: "Vì sao mục tiêu calo tôi không tự đổi được?",
    a: "Mục tiêu calo/macro do hệ thống AI tính dựa trên hồ sơ và chu kỳ tập của bạn. Bạn có thể tự đặt mục tiêu tuỳ chỉnh trong trang Dinh dưỡng (goalMode: CUSTOM) nếu muốn ghi đè.",
  },
  {
    q: "Đổi đơn vị đo có ảnh hưởng dữ liệu đã lưu không?",
    a: "Không. Dữ liệu gốc luôn lưu ở hệ mét (cm/kg) và kcal — đổi đơn vị chỉ đổi cách hiển thị/nhập liệu.",
  },
  {
    q: "Vì sao tôi không thấy nút xoá tài khoản?",
    a: "Hiện tại chỉ hỗ trợ xoá dữ liệu hồ sơ (Quyền riêng tư & Dữ liệu) — xoá toàn bộ tài khoản trên mọi dịch vụ chưa được hỗ trợ.",
  },
  {
    q: "Thông báo có gửi qua email/SMS không?",
    a: "Chưa — mọi thông báo hiện chỉ hiển thị trong ứng dụng.",
  },
];

export function HelpAboutSection() {
  const navigate = useNavigate();
  return (
    <>
      <SectionCard
        id="help"
        icon={HelpCircle}
        iconColor="text-amber-400"
        iconBg="bg-amber-500/10 border-amber-500/20"
        title="Trợ giúp"
        description="Câu hỏi thường gặp"
      >
        <div className="space-y-2">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3 group"
            >
              <summary className="text-sm text-zinc-200 font-semibold cursor-pointer list-none">
                {item.q}
              </summary>
              <p className="text-xs text-zinc-500 mt-2">{item.a}</p>
            </details>
          ))}
        </div>
        <button
          type="button"
          onClick={() => navigate("/client/library")}
          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
        >
          <Compass className="w-3.5 h-3.5" /> Khám phá thư viện bài tập, thực phẩm, kiến thức
          dinh dưỡng và nhóm cơ
        </button>
      </SectionCard>

      <SectionCard
        id="about"
        icon={Info}
        iconColor="text-zinc-400"
        iconBg="bg-zinc-500/10 border-zinc-500/20"
        title="Giới thiệu"
        description="Về Fitness Assistant"
      >
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Phiên bản</span>
          <span className="text-zinc-200 font-mono" data-testid="settings-app-version">
            {APP_VERSION}
          </span>
        </div>
        <p className="text-xs text-zinc-500">
          Fitness Assistant — trợ lý tập luyện &amp; dinh dưỡng với AI Coach, giáo
          án tập luyện thích ứng và theo dõi tiến độ.
        </p>
        <a
          href="https://github.com/trmizy/fitness-assistant"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 w-fit"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Mã nguồn dự án
        </a>
        <p className="text-[11px] text-zinc-600">
          Điều khoản sử dụng / Chính sách quyền riêng tư: chưa có trang riêng trong
          phiên bản này.
        </p>
      </SectionCard>
    </>
  );
}
