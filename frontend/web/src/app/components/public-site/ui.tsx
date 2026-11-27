import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRightIcon } from "@phosphor-icons/react";

/** Đường dẫn vào app thật — route tương đối cùng domain (đăng ký, đăng nhập, đăng ký đối tác). */
export const APP = {
  register: "/register",
  login: "/login",
  partnerApply: "/partner/apply",
} as const;

/** Đăng ký huấn luyện viên: qua trang đăng nhập (có link Đăng ký), đăng nhập xong vào thẳng đơn đăng ký PT. */
export const PT_APPLY = { href: APP.login, state: { from: "/client/pt-application" } } as const;

export function Wrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ps-wrap ${className}`}>{children}</div>;
}

/** Nhãn mục — chữ thường, không viết hoa giãn chữ (dễ đọc hơn bản cũ). */
export function Kicker({ children, className = "", onDark = false }: { children: ReactNode; className?: string; onDark?: boolean }) {
  return (
    <p className={`inline-flex items-center gap-2 text-[0.92rem] font-medium ${onDark ? "text-ps-band-muted" : "text-ps-ink-3"} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${onDark ? "bg-ps-band-accent" : "bg-ps-accent"}`} aria-hidden="true" />
      {children}
    </p>
  );
}

export function Btn({
  href, state, children, variant = "primary", arrow = false, className = "",
}: { href: string; state?: unknown; children: ReactNode; variant?: "primary" | "secondary" | "on-dark" | "ghost-dark"; arrow?: boolean; className?: string }) {
  const cls = `ps-btn ps-btn-${variant} ${className}`;
  const inner = (
    <>
      {children}
      {arrow && <ArrowRightIcon size={18} weight="bold" aria-hidden="true" />}
    </>
  );
  // Đường dẫn trong app đi qua router (không tải lại trang); #hash và link ngoài dùng thẻ <a>.
  return href.startsWith("/") ? (
    <Link to={href} state={state} className={cls}>{inner}</Link>
  ) : (
    <a href={href} className={cls} {...(href.startsWith("http") ? { rel: "noopener" } : {})}>{inner}</a>
  );
}

/** Ảnh responsive: srcset 2 kích thước đã tối ưu (public/media). Luôn có width/height để không CLS. */
export function Photo({
  name, sizes = [800, 1400], alt, className = "", imgClassName = "", w, h, eager = false, style, pos, sizesAttr = "(min-width: 1024px) 50vw, 100vw",
}: {
  name: string; sizes?: number[]; alt: string; className?: string; imgClassName?: string; w: number; h: number; eager?: boolean; style?: CSSProperties; pos?: string; sizesAttr?: string;
}) {
  const srcSet = sizes.map((s) => `/public-site/media/${name}-${s}.webp ${s}w`).join(", ");
  return (
    <div className={`overflow-hidden ${className}`} style={style}>
      <img
        src={`/public-site/media/${name}-${sizes[0]}.webp`}
        srcSet={srcSet}
        sizes={sizesAttr}
        alt={alt}
        width={w}
        height={h}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        {...(eager ? ({ fetchpriority: "high" } as Record<string, string>) : {})}
        className={`h-full w-full object-cover ${imgClassName}`}
        style={pos ? { objectPosition: pos } : undefined}
      />
    </div>
  );
}

/** Nhãn "minh hoạ" cho mọi UI preview chưa phải ảnh chụp app thật. */
export function ConceptTag({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[0.75rem] font-medium ${onDark ? "bg-white/10 text-ps-band-muted" : "bg-ps-sunk text-ps-ink-3"}`}>
      Giao diện minh hoạ
    </span>
  );
}
