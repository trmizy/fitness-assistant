/** Giới hạn "Thông tin giới thiệu" (chi nhánh + thương hiệu) — trùng giới hạn ở gym-service schemas. */
export const ABOUT_MAX = 300;

/** Bộ đếm ký tự dưới ô giới thiệu; quá giới hạn (dữ liệu cũ dài hơn) thì báo cần rút gọn. */
export function AboutCounter({ value }: { value: string | null | undefined }) {
  const n = (value ?? "").length;
  const over = n > ABOUT_MAX;
  return (
    <p className={`mt-1 text-right text-[11px] ${over ? "text-amber-300" : "text-zinc-500"}`}>
      {over ? `Đang có ${n} ký tự — hãy rút gọn còn tối đa ${ABOUT_MAX} để lưu được. ` : ""}
      {n}/{ABOUT_MAX}
    </p>
  );
}
