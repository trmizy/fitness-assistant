import { Link, useNavigate } from "react-router";
import { ArrowLeftIcon as ArrowLeft, ImageIcon, MapPinIcon as MapPin, UserCircleIcon as AvatarIcon, ScalesIcon as LicenseIcon } from "@phosphor-icons/react";

const SOURCES = [
  {
    id: "pexels",
    icon: ImageIcon,
    title: "Ảnh minh hoạ phòng gym & huấn luyện viên — Pexels",
    badge: "Pexels License",
    description:
      "Ảnh không gian phòng tập, khu chức năng và ảnh minh hoạ huấn luyện viên được sưu tầm từ Pexels để phục vụ môi trường minh hoạ cho đồ án/khoá luận.",
    href: "https://www.pexels.com/license/",
    linkLabel: "Giấy phép Pexels",
  },
  {
    id: "dicebear",
    icon: AvatarIcon,
    title: "Ảnh đại diện tổng hợp — DiceBear",
    badge: "CC0 1.0 Public Domain",
    description:
      "Ảnh đại diện của các tài khoản minh hoạ được tạo tự động bằng thư viện DiceBear theo các phong cách vector CC0 (Lorelei, Notionists, Open Peeps), không sử dụng chân dung người thật.",
    href: "https://www.dicebear.com/licenses/",
    linkLabel: "Thông tin bản quyền DiceBear",
  },
  {
    id: "osm-geo",
    icon: MapPin,
    title: "Bản đồ & dữ liệu địa giới hành chính Việt Nam",
    badge: "ODbL & MIT",
    description:
      "Lớp bản đồ hiển thị chi nhánh sử dụng dữ liệu từ OpenStreetMap contributors (ODbL). Danh mục 34 tỉnh/thành và 3.321 phường/xã tham chiếu bộ dữ liệu thanglequoc/vietnamese-provinces-database (giấy phép MIT).",
    href: "https://www.openstreetmap.org/copyright",
    linkLabel: "Bản quyền OpenStreetMap",
  },
] as const;

export function AttributionsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/client/coaches"))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
          </button>
          <Link
            to="/client/coaches"
            className="text-xs font-medium text-green-400 hover:text-green-300"
          >
            Về trang tìm kiếm
          </Link>
        </div>

        <header className="space-y-1.5">
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <LicenseIcon className="w-5 h-5 text-green-400 shrink-0" />
            Nguồn ảnh &amp; giấy phép dữ liệu
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Ghi nhận các nguồn tư liệu ảnh minh hoạ và dữ liệu bản đồ đang sử dụng trên hệ thống web Gymini.
          </p>
        </header>

        <div className="space-y-3">
          {SOURCES.map((src) => {
            const Icon = src.icon;
            return (
              <section
                key={src.id}
                className="rounded-xl border border-zinc-800/80 bg-zinc-900 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-green-400" />
                    </div>
                    <h2 className="text-sm font-bold text-zinc-100">{src.title}</h2>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700/60 text-zinc-300 whitespace-nowrap">
                    {src.badge}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">{src.description}</p>
                <a
                  href={src.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-semibold text-green-400 hover:text-green-300"
                >
                  {src.linkLabel}
                </a>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

