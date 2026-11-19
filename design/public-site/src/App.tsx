import { useEffect, useLayoutEffect } from "react";
import { createBrowserRouter, Outlet, useLocation, useNavigationType } from "react-router";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { HomePage } from "./pages/HomePage";
import { TrainersPage } from "./pages/TrainersPage";
import { GymsPage } from "./pages/GymsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ArticlePage } from "./pages/ArticlePage";
import { NotFoundPage } from "./pages/NotFoundPage";

/** Link có #hash (vd. /#cach-hoat-dong) cuộn tới đúng mục sau khi trang render. */
function HashScroll() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 60);
    return () => window.clearTimeout(t);
  }, [hash, pathname]);
  return null;
}

/**
 * Quản lý cuộn: điều hướng mới (PUSH/REPLACE) về đầu trang; back/forward và refresh (POP)
 * để trình duyệt tự khôi phục vị trí (history.scrollRestoration = "auto").
 * (ScrollRestoration của React Router bỏ qua vị trí đã lưu khi refresh trong bản này — đã kiểm bằng trình duyệt.)
 */
function ScrollManager() {
  const { key, hash } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => { if ("scrollRestoration" in history) history.scrollRestoration = "auto"; }, []);
  useLayoutEffect(() => { if (type !== "POP" && !hash) window.scrollTo(0, 0); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Layout() {
  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-clip">
      <a href="#noi-dung" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-elev focus:px-5 focus:py-3 focus:shadow">
        Bỏ qua tới nội dung
      </a>
      <SiteHeader />
      <main id="noi-dung" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <ScrollManager />
      <HashScroll />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: HomePage },
      { path: "huan-luyen-vien", Component: TrainersPage },
      { path: "phong-gym", Component: GymsPage },
      { path: "kien-thuc", Component: KnowledgePage },
      { path: "kien-thuc/:slug", Component: ArticlePage },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);
