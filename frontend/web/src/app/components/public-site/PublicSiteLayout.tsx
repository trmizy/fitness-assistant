import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router";
import { useSettings } from "../../context/SettingsContext";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

/** Link có #hash (vd. /#cach-hoat-dong) cuộn tới đúng mục sau khi trang render. */
function HashScroll() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = window.setTimeout(
      () =>
        document.getElementById(id)?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        }),
      60,
    );
    return () => window.clearTimeout(t);
  }, [hash, pathname]);
  return null;
}

/**
 * Quản lý cuộn: điều hướng mới (PUSH/REPLACE) về đầu trang; back/forward và refresh (POP)
 * để trình duyệt tự khôi phục vị trí (history.scrollRestoration = "auto").
 * (ScrollRestoration của React Router bỏ qua vị trí đã lưu khi refresh trong bản này — đã kiểm bằng trình duyệt.)
 * Chỉ nằm trong layout trang công khai: không đổi cách cuộn của phần còn lại của app.
 */
function ScrollManager() {
  const { key, hash } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "auto";
  }, []);
  useLayoutEffect(() => {
    if (type !== "POP" && !hash) window.scrollTo(0, 0);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Khung của website công khai (header + footer + quản lý cuộn). Mọi token/class nằm dưới `.ps-root`
 * (src/styles/public-site.css) nên không ảnh hưởng phần còn lại của app.
 *
 * Dùng theo hai cách: là layout route không đường dẫn (render <Outlet/>), hoặc nhận `children`
 * (RootRedirect dựng trang chủ cho khách tại "/").
 */
export function PublicSiteLayout({ children }: { children?: ReactNode }) {
  const { registerDefaultTheme } = useSettings();

  // Website mặc định sáng, trừ khi người dùng đã chọn giao diện rõ ràng (SettingsContext ưu tiên lựa chọn đó).
  // Layout effect: phải tới DOM trước lần vẽ đầu để không nháy tối rồi sáng.
  useLayoutEffect(() => registerDefaultTheme("light"), [registerDefaultTheme]);

  return (
    <div className="ps-root flex flex-col overflow-x-clip">
      <a
        href="#noi-dung"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-ps-elev focus:px-5 focus:py-3 focus:shadow"
      >
        Bỏ qua tới nội dung
      </a>
      <SiteHeader />
      <main id="noi-dung" className="flex-1">
        {children ?? <Outlet />}
      </main>
      <SiteFooter />
      <ScrollManager />
      <HashScroll />
    </div>
  );
}
