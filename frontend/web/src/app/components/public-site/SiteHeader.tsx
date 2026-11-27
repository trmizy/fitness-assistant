import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ListIcon, MoonIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { AppLogo } from "../brand/AppLogo";
import { useSettings } from "../../context/SettingsContext";
import { APP, Wrap } from "./ui";

const NAV = [
  { to: "/#cach-hoat-dong", label: "Cách hoạt động" },
  { to: "/huan-luyen-vien", label: "Huấn luyện viên" },
  { to: "/phong-gym", label: "Phòng gym" },
  { to: "/kien-thuc", label: "Kiến thức" },
];

export function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Gymini — trang chủ">
      <AppLogo className="h-[34px] w-[34px] flex-shrink-0 justify-center" imgClassName="gymini-brand-logo h-[34px] w-[34px]" />
      <span className={`font-ps-display text-[1.45rem] font-bold tracking-[-0.02em] ${onDark ? "text-ps-band-ink" : "text-ps-ink"}`}>gymini</span>
    </Link>
  );
}

export function SiteHeader() {
  // Giao diện dùng chung với cả app: nút này gọi setTheme của SettingsContext (lưu lựa chọn rõ ràng của người dùng).
  const { effectiveTheme: theme, setTheme } = useSettings();
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  const { pathname, hash } = useLocation();

  useEffect(() => setOpen(false), [pathname, hash]);

  // Nền header: dùng một sentinel + IntersectionObserver (không scroll listener).
  useEffect(() => {
    const s = document.getElementById("top-sentinel");
    if (!s) return;
    const io = new IntersectionObserver(([e]) => setSolid(!e.isIntersecting));
    io.observe(s);
    return () => io.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <div id="top-sentinel" className="absolute left-0 top-0 h-6 w-px" aria-hidden="true" />
      <header className={`ps-site-header fixed inset-x-0 top-0 z-50 ${solid || open ? "ps-is-solid" : ""}`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <Wrap className="flex h-[72px] items-center justify-between gap-6">
          <Logo />

          <nav aria-label="Điều hướng chính" className="ps-nav-pill hidden items-center gap-1 rounded-full p-1 lg:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-[0.95rem] font-medium transition-colors duration-[250ms] ${
                    isActive && !n.to.includes("#") ? "bg-ps-sunk text-ps-ink" : "text-ps-ink-2 hover:bg-ps-sunk hover:text-ps-ink"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="hidden h-11 w-11 place-items-center rounded-full text-ps-ink-2 transition-colors hover:bg-ps-sunk hover:text-ps-ink sm:grid"
              aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
            >
              {theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
            </button>
            <Link to={APP.login} className="hidden rounded-full px-4 py-2 text-[0.95rem] font-medium text-ps-ink-2 hover:text-ps-ink md:inline-flex">
              Đăng nhập
            </Link>
            <Link to={APP.register} className="ps-btn ps-btn-primary ps-btn-sm">Bắt đầu</Link>
            <button
              type="button"
              className="grid h-11 w-11 place-items-center rounded-full border border-ps-line bg-ps-elev text-ps-ink lg:hidden"
              aria-expanded={open}
              aria-controls="menu-di-dong"
              aria-label={open ? "Đóng menu" : "Mở menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <XIcon size={20} /> : <ListIcon size={20} />}
            </button>
          </div>
        </Wrap>

        {open && (
          <div id="menu-di-dong" className="ps-sheet h-[calc(100dvh-72px)] overflow-y-auto border-t border-ps-line bg-ps-bg lg:hidden">
            <Wrap className="flex min-h-full flex-col py-6">
              <nav aria-label="Điều hướng di động" className="flex flex-col">
                {NAV.map((n, i) => (
                  <Link key={n.to} to={n.to} style={{ ["--i" as string]: i }}
                    className="ps-sheet-item border-b border-ps-line py-5 font-ps-display text-[1.9rem] font-semibold tracking-[-0.02em] text-ps-ink">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="ps-sheet-item mt-8 grid gap-3" style={{ ["--i" as string]: NAV.length }}>
                <Link to={APP.register} className="ps-btn ps-btn-primary w-full">Bắt đầu lộ trình</Link>
                <Link to={APP.login} className="ps-btn ps-btn-secondary w-full">Đăng nhập</Link>
              </div>
              <button type="button" onClick={toggleTheme} className="ps-sheet-item mt-auto flex items-center gap-3 pt-10 text-ps-ink-2" style={{ ["--i" as string]: NAV.length + 1 }}>
                {theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
                {theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
              </button>
            </Wrap>
          </div>
        )}
      </header>
    </>
  );
}
