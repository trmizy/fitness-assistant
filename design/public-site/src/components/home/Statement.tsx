import { Wrap } from "../ui";

const TEXT = "Kế hoạch tập tốt là kế hoạch biết thay đổi. Gymini chia hành trình của bạn thành từng chu kỳ khoảng bốn tuần, xem lại số liệu thật ở cuối mỗi chu kỳ, rồi mới quyết định bước tiếp theo.";
const EMPHASIS = new Set(["biết", "thay", "đổi."]);

/**
 * Câu tuyên bố — chữ sáng dần theo tiến độ cuộn (CSS scroll-driven, view timeline).
 * Tách theo TỪ (không theo ký tự), từ vẫn nguyên vẹn → screen reader đọc liền mạch.
 * Trình duyệt không hỗ trợ / reduced motion: hiện đủ, tĩnh.
 */
export function Statement() {
  const words = TEXT.split(" ");
  return (
    <section className="pb-20 pt-24 sm:pb-28 sm:pt-36">
      <Wrap>
        <p className="stmt max-w-[30ch] font-display text-[clamp(1.85rem,1rem+2.9vw,3.6rem)] font-medium leading-[1.2] tracking-[-0.025em] text-ink">
          {words.map((w, i) => (
            <span key={i} className={`stmt-word ${EMPHASIS.has(w) ? "text-accent-text" : ""}`} style={{ ["--p" as string]: i / words.length }}>
              {w}{i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      </Wrap>
    </section>
  );
}
