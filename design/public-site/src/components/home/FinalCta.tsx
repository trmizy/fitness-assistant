import { ProgressLine } from "../ProgressLine";
import { APP, Btn, Photo, Wrap } from "../ui";

/** Kết trang: ảnh toàn khung + Đường tiến đã vẽ xong (tĩnh — chỉ hero có vòng lặp). */
export function FinalCta({ title = "Bắt đầu chu kỳ đầu tiên của bạn.", body = "Tạo tài khoản, trả lời vài câu hỏi về mục tiêu và thói quen. Gymini lập lộ trình đầu tiên từ đó.", cta = { href: APP.register, label: "Bắt đầu lộ trình" } }: {
  title?: string; body?: string; cta?: { href: string; label: string };
}) {
  return (
    <section className="relative isolate overflow-hidden bg-band text-band-ink">
      <div className="absolute inset-0 -z-10">
        <Photo name="cta" sizes={[1000, 1920]} alt="" w={1920} h={1280} className="parallax-slow h-full" sizesAttr="100vw" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.72)_0%,rgba(10,10,10,0.82)_55%,rgba(10,10,10,0.96)_100%)]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[24%] opacity-90 sm:h-[55%]">
        <ProgressLine mode="static" nodes={[{ x: 0.2, y: 0.78 }, { x: 0.5, y: 0.58 }, { x: 0.8, y: 0.38 }]} start={{ x: 0, y: 0.86 }} end={{ x: 1, y: 0.3 }}
          color="var(--band-accent)" nodeFill="#0a0a0a" strokeWidth={2.5} />
      </div>
      <Wrap className="relative py-32 sm:py-44">
        <h2 className="t-display sr max-w-[13ch] text-[clamp(2.6rem,1.3rem+5vw,6rem)]">{title}</h2>
        <p className="sr mt-6 max-w-[44ch] text-[1.15rem] leading-relaxed text-[#d4d4d8]">{body}</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Btn href={cta.href} variant="on-dark" arrow>{cta.label}</Btn>
          <Btn href={APP.login} variant="ghost-dark">Đã có tài khoản</Btn>
        </div>
      </Wrap>
    </section>
  );
}
