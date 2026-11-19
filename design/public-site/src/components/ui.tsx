import type { CSSProperties, ReactNode } from "react";
import { ArrowRightIcon } from "@phosphor-icons/react";

/**
 * Đường dẫn vào app thật trên gymini.vn. Prototype trỏ thẳng tới production để
 * không có CTA chết; khi port vào repo, đổi về đường dẫn tương đối cùng domain.
 */
export const APP = {
  register: "https://gymini.vn/register",
  login: "https://gymini.vn/login",
  partnerApply: "https://gymini.vn/partner/apply",
} as const;

export function Wrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`wrap ${className}`}>{children}</div>;
}

/** Nhãn mục — chữ thường, không viết hoa giãn chữ (dễ đọc hơn bản cũ). */
export function Kicker({ children, className = "", onDark = false }: { children: ReactNode; className?: string; onDark?: boolean }) {
  return (
    <p className={`inline-flex items-center gap-2 text-[0.92rem] font-medium ${onDark ? "text-band-muted" : "text-ink-3"} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${onDark ? "bg-band-accent" : "bg-accent"}`} aria-hidden="true" />
      {children}
    </p>
  );
}

export function Btn({
  href, children, variant = "primary", arrow = false, className = "", external = true,
}: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "on-dark" | "ghost-dark"; arrow?: boolean; className?: string; external?: boolean }) {
  return (
    <a href={href} className={`btn btn-${variant} ${className}`} {...(external && href.startsWith("http") ? { rel: "noopener" } : {})}>
      {children}
      {arrow && <ArrowRightIcon size={18} weight="bold" aria-hidden="true" />}
    </a>
  );
}

/** Ảnh responsive: srcset 2 kích thước đã tối ưu (public/media). Luôn có width/height để không CLS. */
export function Photo({
  name, sizes = [800, 1400], alt, className = "", imgClassName = "", w, h, eager = false, style, pos, sizesAttr = "(min-width: 1024px) 50vw, 100vw",
}: {
  name: string; sizes?: number[]; alt: string; className?: string; imgClassName?: string; w: number; h: number; eager?: boolean; style?: CSSProperties; pos?: string; sizesAttr?: string;
}) {
  const srcSet = sizes.map((s) => `/media/${name}-${s}.webp ${s}w`).join(", ");
  return (
    <div className={`overflow-hidden ${className}`} style={style}>
      <img
        src={`/media/${name}-${sizes[0]}.webp`}
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
    <span className={`rounded-full px-2.5 py-1 text-[0.75rem] font-medium ${onDark ? "bg-white/10 text-band-muted" : "bg-sunk text-ink-3"}`}>
      Giao diện minh hoạ
    </span>
  );
}
