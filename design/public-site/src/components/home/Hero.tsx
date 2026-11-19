import Magnet from "../reactbits/Magnet";
import { ProgressLine } from "../ProgressLine";
import { APP, Btn, Kicker, Photo, Wrap } from "../ui";

const LINES = [
  { text: "Tập có lộ trình,", chip: { name: "chip-nguoi-tap", w: 480, h: 720, alt: "" } },
  { text: "có người kèm,", chip: { name: "chip-hlv", w: 480, h: 640, alt: "" } },
  { text: "có nơi để tập.", chip: { name: "chip-phong", w: 480, h: 288, alt: "" } },
];

const PANELS = [
  { name: "stage-nguoi-tap", w: 800, h: 1200, alt: "IFBB Pro Hoàng Hải Đăng giơ thẻ IFBB Pro trên sân khấu tại Malaysia", title: "Người tập", sub: "Lộ trình chia theo chu kỳ, đánh giá bằng số liệu thật", credit: "IFBB Pro Hoàng Hải Đăng", pos: "50% 22%" },
  { name: "stage-hlv", w: 800, h: 1067, alt: "IFBB Pro Natural Giang Hoàng nhận giải Overall Men's Physique trên sân khấu", title: "Huấn luyện viên", sub: "Làm việc độc lập, hợp đồng chốt số buổi và giá", credit: "IFBB Pro Natural Giang Hoàng", pos: "62% 40%" },
  { name: "stage-phong", w: 800, h: 533, alt: "Khu tạ tự do với giá đỡ và bánh tạ trong phòng gym", title: "Phòng gym", sub: "Đã thẩm định giấy tờ, mua gói và vào cửa bằng QR", credit: "", pos: "35% 50%" },
];

/** Nhãn nhỏ ở từng nút của Đường tiến. */
const NODE_LABELS = ["Bạn", "Người kèm", "Nơi tập"];

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-[112px] sm:pt-[132px]">
      <div className="dots pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      <Wrap>
        <div className="enter" style={{ ["--d" as string]: 0 }}>
          <Kicker>Lộ trình tập · Huấn luyện viên độc lập · Phòng gym</Kicker>
        </div>

        {/* H1 giữ nguyên câu — chỉ chia theo dòng để chạy hiệu ứng, ảnh chèn là trang trí (aria-hidden). */}
        <h1 className="t-display mt-6 max-w-[16ch] text-ink sm:max-w-none">
          {LINES.map((l, i) => (
            <span key={l.text} className="line-mask" style={{ ["--i" as string]: i }}>
              <span>
                {l.text}
                <span className="chip-img" style={{ ["--i" as string]: i }} aria-hidden="true">
                  <img src={`/media/${l.chip.name}-480.webp`} alt="" width={l.chip.w} height={l.chip.h} />
                </span>
              </span>
            </span>
          ))}
        </h1>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <p className="t-lead enter max-w-[46ch]" style={{ ["--d" as string]: 520 }}>
            Gymini lập lộ trình tập và ăn bằng tiếng Việt, xem lại số liệu sau mỗi chu kỳ khoảng bốn tuần,
            và kết nối bạn với huấn luyện viên độc lập cùng phòng gym đã được thẩm định.
          </p>
          <div className="enter flex flex-wrap gap-3" style={{ ["--d" as string]: 640 }}>
            <Magnet padding={50} magnetStrength={5} maxOffset={8}>
              <Btn href={APP.register} arrow>Bắt đầu lộ trình</Btn>
            </Magnet>
            <a href="#he-sinh-thai" className="btn btn-secondary">Tìm huấn luyện viên</a>
          </div>
        </div>
      </Wrap>

      {/* Sân khấu: Người tập × Huấn luyện viên × Phòng gym, nối bằng Đường tiến */}
      <div className="mt-14 px-[max(8px,1vw)] sm:mt-20">
        <div className="stage-zoom enter relative mx-auto max-w-[1600px] overflow-hidden rounded-[28px] bg-band sm:rounded-[40px]"
          style={{ ["--d" as string]: 760 }}>
          <div className="grid aspect-[4/5] grid-cols-3 gap-[3px] sm:aspect-[16/8.5] lg:aspect-[16/7.2]">
            {PANELS.map((p, i) => (
              <figure key={p.name} className="relative h-full overflow-hidden">
                <Photo name={p.name} alt={p.alt} w={p.w} h={p.h} eager={i === 0} className="h-full" sizesAttr="(min-width: 640px) 34vw, 34vw"
                  pos={p.pos} imgClassName="scale-[1.02]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/10" aria-hidden="true" />
                <figcaption className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-6 lg:p-8">
                  <p className="font-display text-[1.05rem] font-semibold leading-tight tracking-[-0.01em] sm:text-[1.6rem] lg:text-[2rem]">{p.title}</p>
                  <p className="mt-1.5 hidden max-w-[30ch] text-[0.95rem] leading-snug text-white/85 md:block">{p.sub}</p>
                  {p.credit && <p className="mt-2 hidden text-[0.78rem] font-medium text-white/75 sm:block">Ảnh: {p.credit}</p>}
                </figcaption>
              </figure>
            ))}
          </div>
          <ProgressLine
            nodes={[{ x: 0.17, y: 0.66 }, { x: 0.5, y: 0.47 }, { x: 0.83, y: 0.28 }]}
            start={{ x: 0, y: 0.74 }}
            end={{ x: 1, y: 0.22 }}
            mode="loop"
            color="var(--band-accent)"
            nodeFill="#0a0a0a"
            strokeWidth={3}
            renderLabel={(i) => (
              <span className="absolute left-0 top-0 -translate-x-1/2 -translate-y-[calc(100%+18px)] whitespace-nowrap rounded-full bg-white/92 px-3 py-1 text-[0.8rem] font-semibold text-[#0a0a0a] shadow-sm sm:text-[0.88rem]">
                {NODE_LABELS[i]}
              </span>
            )}
          />
        </div>
        <p className="wrap mt-3 text-[0.8rem] text-ink-3">Ảnh vận động viên IFBB Pro Việt Nam và Mr. Olympia lấy từ Internet, chỉ dùng cho bản demo khoá luận. Các vận động viên không liên quan và không hợp tác với Gymini.</p>
      </div>
    </section>
  );
}
