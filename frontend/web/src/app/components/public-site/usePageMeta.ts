import { useEffect } from "react";

const SITE = "https://gymini.vn";
const DEFAULT_IMAGE = "/public-site/media/stage-hlv-1400.webp";

/** Đặt meta, trả về hàm khôi phục giá trị cũ (hoặc gỡ thẻ nếu trước đó chưa có). */
function setMeta(attr: "name" | "property", key: string, value: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const created = !el;
  const previous = el?.getAttribute("content") ?? null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
  return () => {
    if (created) el!.remove();
    else if (previous !== null) el!.setAttribute("content", previous);
  };
}

/**
 * Title, description, canonical và Open Graph theo từng trang công khai.
 * Khi rời trang, mọi thẻ được trả về như cũ để phần còn lại của app (đăng nhập, workspace) không mang meta/canonical của trang web.
 * Lưu ý: trang render phía client — máy tìm kiếm chạy JS (Google) đọc được, mạng xã hội
 * (Facebook/Zalo) chỉ đọc thẻ mặc định trong index.html. Muốn đúng từng trang cho mạng xã hội
 * thì cần prerender.
 */
export function usePageMeta(title: string, description: string, image = DEFAULT_IMAGE) {
  useEffect(() => {
    const url = SITE + window.location.pathname;
    const previousTitle = document.title;
    document.title = title;
    const restores = [
      setMeta("name", "description", description),
      setMeta("property", "og:title", title),
      setMeta("property", "og:description", description),
      setMeta("property", "og:url", url),
      setMeta("property", "og:image", SITE + image),
    ];
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const linkCreated = !link;
    const previousHref = link?.href ?? null;
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = url;
    return () => {
      document.title = previousTitle;
      restores.forEach((restore) => restore());
      if (linkCreated) link!.remove();
      else if (previousHref !== null) link!.href = previousHref;
    };
  }, [title, description, image]);
}
