import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ListIcon, MoonIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { APP, Wrap } from "./ui";

const NAV = [
  { to: "/#cach-hoat-dong", label: "Cách hoạt động" },
  { to: "/huan-luyen-vien", label: "Huấn luyện viên" },
  { to: "/phong-gym", label: "Phòng gym" },
  { to: "/kien-thuc", label: "Kiến thức" },
];

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("gymini-site-theme", theme); } catch { /* bị chặn: bỏ qua */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
}

export function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Gymini — trang chủ">
      <img src="/gymini-logo-dark.png" alt="" width={34} height={34} className="h-[34px] w-[34px]" />
      <span className={`font-display text-[1.45rem] font-bold tracking-[-0.02em] ${onDark ? "text-band-ink" : "text-ink"}`}>gymini</span>
    </Link>
  );
}

export function SiteHeader() {
  const [theme, toggleTheme] = useTheme();
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
      <header className={`site-header fixed inset-x-0 top-0 z-50 ${solid || open ? "is-solid" : ""}`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <Wrap className="flex h-[72px] items-center justify-between gap-6">
          <Logo />

          <nav aria-label="Điều hướng chính" className="nav-pill hidden items-center gap-1 rounded-full p-1 lg:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-[0.95rem] font-medium transition-colors duration-[250ms] ${
                    isActive && !n.to.includes("#") ? "bg-sunk text-ink" : "text-ink-2 hover:bg-sunk hover:text-ink"
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
              className="hidden h-11 w-11 place-items-center rounded-full text-ink-2 transition-colors hover:bg-sunk hover:text-ink sm:grid"
              aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
            >
              {theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
            </button>
            <a href={APP.login} className="hidden rounded-full px-4 py-2 text-[0.95rem] font-medium text-ink-2 hover:text-ink md:inline-flex">
              Đăng nhập
            </a>
            <a href={APP.register} className="btn btn-primary btn-sm">Bắt đầu</a>
            <button
              type="button"
              className="grid h-11 w-11 place-items-center rounded-full border border-line bg-elev text-ink lg:hidden"
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
          <div id="menu-di-dong" className="sheet h-[calc(100dvh-72px)] overflow-y-auto border-t border-line bg-bg lg:hidden">
            <Wrap className="flex min-h-full flex-col py-6">
              <nav aria-label="Điều hướng di động" className="flex flex-col">
                {NAV.map((n, i) => (
                  <Link key={n.to} to={n.to} style={{ ["--i" as string]: i }}
                    className="sheet-item border-b border-line py-5 font-display text-[1.9rem] font-semibold tracking-[-0.02em] text-ink">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="sheet-item mt-8 grid gap-3" style={{ ["--i" as string]: NAV.length }}>
                <a href={APP.register} className="btn btn-primary w-full">Bắt đầu lộ trình</a>
                <a href={APP.login} className="btn btn-secondary w-full">Đăng nhập</a>
              </div>
              <button type="button" onClick={toggleTheme} className="sheet-item mt-auto flex items-center gap-3 pt-10 text-ink-2" style={{ ["--i" as string]: NAV.length + 1 }}>
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
