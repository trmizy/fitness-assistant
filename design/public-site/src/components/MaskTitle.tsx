/** Tiêu đề trang: chạy hiệu ứng theo DÒNG, câu chữ giữ nguyên cho screen reader. */
export function MaskTitle({ lines, className = "", as: Tag = "h1" }: { lines: string[]; className?: string; as?: "h1" | "h2" }) {
  return (
    <Tag className={className}>
      {lines.map((l, i) => (
        <span key={l} className="line-mask" style={{ ["--i" as string]: i }}>
          <span>{l}{i < lines.length - 1 ? " " : ""}</span>
        </span>
      ))}
    </Tag>
  );
}
