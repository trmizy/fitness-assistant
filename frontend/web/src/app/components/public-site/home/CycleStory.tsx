import { useEffect, useRef, useState } from "react";
import { ProgressLine } from "../ProgressLine";
import { ConceptTag, Kicker, Wrap } from "../ui";
import { PreviewAssessment, PreviewBaseline, PreviewNutrition, PreviewSession } from "./CyclePreviews";

const STEPS = [
  { when: "Đầu chu kỳ", title: "Lấy mốc", body: "Gymini lưu số đo đầu chu kỳ: cân nặng và, nếu bạn có, kết quả InBody đọc từ ảnh chụp phiếu đo. Mục tiêu calo và macro được tính từ hồ sơ của bạn.", Preview: PreviewBaseline },
  { when: "Mỗi buổi tập", title: "Ghi lại từng hiệp", body: "Bạn ghi mức tạ, số lần và cảm nhận độ nặng. Bài tập lấy từ danh mục bài tập có sẵn, không phải do AI tự nghĩ ra.", Preview: PreviewSession },
  { when: "Mỗi ngày", title: "Ăn theo mục tiêu", body: "Thực đơn đi theo mục tiêu năng lượng của bạn. Bạn đánh dấu bữa đã ăn, Gymini cộng dồn để bạn biết còn bao nhiêu.", Preview: PreviewNutrition },
  { when: "Cuối chu kỳ", title: "Đánh giá và quyết định", body: "Hệ thống tổng hợp năm nhóm số liệu của bốn tuần rồi đưa ra một quyết định. AI chỉ giải thích lý do, không tự quyết.", Preview: PreviewAssessment },
];

/**
 * Kể chuyện một chu kỳ. Desktop: cột trái là các bước (cuộn tự nhiên), cột phải ghim (sticky)
 * hiển thị màn minh hoạ của bước đang đọc. Bước active xác định bằng IntersectionObserver —
 * không chặn cuộn, không scroll listener. Mobile: mỗi bước kèm màn minh hoạ ngay bên dưới.
 */
export function CycleStory() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i)); }),
      { rootMargin: "-30% 0px -60% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const Active = STEPS[active].Preview;

  return (
    <section id="cach-hoat-dong" className="scroll-mt-24 border-t border-ps-line pt-24 sm:pt-32">
      <Wrap>
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <Kicker>Cách hoạt động</Kicker>
            <h2 className="ps-t-h2 ps-sr mt-4 max-w-[14ch]">Một chu kỳ, bốn việc rõ ràng.</h2>
          </div>
          <p className="ps-t-lead ps-sr max-w-[44ch] lg:justify-self-end">
            Lộ trình dài hạn được chia thành nhiều chu kỳ ngắn. Mỗi chu kỳ có mốc riêng, giáo án riêng và một lần đánh giá riêng.
          </p>
        </div>

        <div className="mt-16 grid gap-10 lg:mt-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          {/* Cột bước */}
          <ol className="grid gap-16 lg:gap-0">
            {STEPS.map((s, i) => (
              <li key={s.title} ref={(el) => { refs.current[i] = el; }} data-i={i}
                className="lg:min-h-[64vh] lg:pt-10">
                <div>
                  <p className="flex items-center gap-3 text-[0.95rem] font-medium text-ps-accent-text">
                    <span className={`ps-tnum grid h-8 w-8 place-items-center rounded-full border text-[0.85rem] transition-colors duration-[250ms] ${active === i ? "lg:border-ps-accent lg:bg-ps-accent lg:text-ps-accent-ink" : ""} border-current`}>{i + 1}</span>
                    {s.when}
                  </p>
                  <h3 className="ps-t-h3 mt-4 text-[clamp(1.7rem,1.2rem+1.6vw,2.6rem)]">{s.title}</h3>
                  <p className="mt-4 max-w-[44ch] text-[1.08rem] leading-relaxed text-ps-ink-2">{s.body}</p>
                </div>
                {/* Mobile/tablet: màn minh hoạ ngay dưới bước */}
                <div className="mt-8 rounded-[24px] border border-ps-line bg-ps-elev p-5 sm:p-6 lg:hidden">
                  <div className="mb-4 flex justify-end"><ConceptTag /></div>
                  <s.Preview />
                </div>
              </li>
            ))}
          </ol>

          {/* Khung ghim desktop */}
          <div className="hidden lg:block">
            <div className="sticky top-[104px] flex h-[min(680px,calc(100dvh-140px))] flex-col overflow-hidden rounded-[32px] border border-ps-line bg-ps-elev"
              style={{ boxShadow: "0 40px 80px -48px rgb(var(--ps-shadow) / 0.35)" }}>
              <div className="flex items-center justify-between border-b border-ps-line px-8 py-5">
                <p className="text-[0.95rem] font-medium text-ps-ink-2">
                  <span className="text-ps-ink">{STEPS[active].when}</span> · {STEPS[active].title}
                </p>
                <ConceptTag />
              </div>
              <div className="relative flex-1 overflow-hidden px-8 py-7">
                <div key={active} className="ps-swap-in"><Active /></div>
              </div>
              {/* Đường tiến — chấm sáng đi theo bước đang đọc */}
              <div className="relative h-[92px] border-t border-ps-line bg-ps-sunk">
                <ProgressLine mode="controlled" active={active}
                  nodes={[{ x: 0.14, y: 0.72 }, { x: 0.38, y: 0.56 }, { x: 0.62, y: 0.4 }, { x: 0.86, y: 0.24 }]}
                  start={{ x: 0, y: 0.8 }} end={{ x: 1, y: 0.2 }} strokeWidth={2.5} nodeFill="var(--ps-bg-sunk)" color="var(--ps-accent-bright)" />
              </div>
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  );
}
