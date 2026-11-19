import { useEffect } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import Magnet from "../components/reactbits/Magnet";
import { FinalCta } from "../components/home/FinalCta";
import { MaskTitle } from "../components/MaskTitle";
import { ProgressLine } from "../components/ProgressLine";
import { APP, Btn, ConceptTag, Kicker, Photo, Wrap } from "../components/ui";

const PACKAGES = [
  { n: "Nền tảng sức mạnh", d: "12 buổi · 60 phút · Trực tiếp", p: "3.600.000 đ" },
  { n: "Giảm mỡ có kèm", d: "8 buổi · 45 phút · Online", p: "1.900.000 đ" },
  { n: "Chỉnh kỹ thuật", d: "4 buổi · 60 phút · Trực tiếp", p: "1.300.000 đ" },
];

const INDEPENDENT = [
  { t: "Gói và giá do bạn đặt", d: "Tối đa 10 gói đang bán. Mỗi gói có số buổi, thời lượng 15–240 phút, giá và hình thức online hoặc trực tiếp." },
  { t: "Lịch do bạn mở", d: "Bạn mở khung giờ trống. Khi lịch trống ít hơn số buổi của gói, khách được cảnh báo trước khi mua." },
  { t: "Nhận khách khi bạn muốn", d: "Tạm ngừng nhận khách mới bất cứ lúc nào mà không ảnh hưởng hợp đồng đang chạy." },
  { t: "Hợp tác với phòng gym là lựa chọn", d: "Muốn dạy trực tiếp tại một phòng gym, bạn gửi đề nghị và thương lượng tỷ lệ chia doanh thu với phòng gym đó." },
];

const STEPS = [
  { t: "Nộp hồ sơ", d: "Chuyên môn, kinh nghiệm, nhóm khách bạn nhận." },
  { t: "Được duyệt", d: "Xác nhận điều khoản dành cho huấn luyện viên." },
  { t: "Đăng gói", d: "Giới thiệu, ảnh và gói được duyệt trước khi hiển thị." },
  { t: "Nhận yêu cầu", d: "Khách có 12 giờ để thanh toán sau khi bạn nhận." },
  { t: "Dạy và ghi buổi", d: "Số buổi còn lại hiện rõ cho cả hai bên." },
];

export function TrainersPage() {
  useEffect(() => { document.title = "Dành cho huấn luyện viên — Gymini"; }, []);
  return (
    <>
      {/* Hero tách đôi: chữ + chân dung có thẻ gói dịch vụ nổi */}
      <section className="relative isolate overflow-hidden pt-[112px] sm:pt-[140px]">
        <div className="dots pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
        <Wrap className="grid items-center gap-14 pb-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="enter"><Kicker>Dành cho huấn luyện viên</Kicker></div>
            <MaskTitle lines={["Dạy độc lập.", "Có hệ thống", "phía sau."]} className="t-display mt-6" />
            <p className="t-lead enter mt-8 max-w-[44ch]" style={{ ["--d" as string]: 480 }}>
              Trên Gymini, bạn không phải nhân viên của phòng gym nào. Bạn tự đặt gói, giá và lịch.
              Gymini giữ hợp đồng, buổi tập và thanh toán rõ ràng cho cả hai bên.
            </p>
            <div className="enter mt-10 flex flex-wrap gap-3" style={{ ["--d" as string]: 600 }}>
              <Magnet padding={50} magnetStrength={5} maxOffset={8}><Btn href={APP.register} arrow>Đăng ký làm huấn luyện viên</Btn></Magnet>
            </div>
          </div>
          <div className="enter relative" style={{ ["--d" as string]: 300 }}>
            <Photo name="trainers-hero" alt="IFBB Pro Classic Physique Nguyễn Hoàng Phúc giơ thẻ IFBB Pro" w={800} h={758} eager pos="50% 30%"
              className="aspect-[4/5] rounded-[32px] bg-sunk sm:rounded-[40px]" sizesAttr="(min-width: 1024px) 45vw, 100vw" />
            <p className="absolute right-4 top-4 rounded-full bg-black/60 px-3 py-1 text-[0.78rem] font-medium text-white">Ảnh: IFBB Pro Classic Nguyễn Hoàng Phúc · demo khoá luận</p>
            <div className="swap-in relative z-10 -mt-28 ml-4 mr-4 rounded-[22px] border border-line bg-elev p-5 sm:-ml-10 sm:mr-auto sm:max-w-[360px]"
              style={{ ["--d" as string]: 700, boxShadow: "0 30px 60px -30px rgb(var(--shadow) / 0.4)" }}>
              <div className="flex items-center justify-between"><p className="font-display text-[1.15rem] font-semibold">Gói của bạn</p><ConceptTag /></div>
              <ul className="mt-3 grid gap-2">
                {PACKAGES.map((p) => (
                  <li key={p.n} className="rounded-xl border border-line px-3.5 py-2.5">
                    <div className="flex items-baseline justify-between gap-3"><p className="font-semibold">{p.n}</p><p className="tnum text-[0.9rem] font-semibold">{p.p}</p></div>
                    <p className="text-[0.82rem] text-ink-3">{p.d}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Wrap>
      </section>

      {/* Độc lập nghĩa là gì — danh sách biên tập, không thẻ */}
      <section className="border-t border-line py-24 sm:py-32">
        <Wrap className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Kicker>Độc lập nghĩa là</Kicker>
            <h2 className="t-h2 sr mt-4 max-w-[12ch]">Bạn quyết định cách mình dạy.</h2>
          </div>
          <dl className="grid">
            {INDEPENDENT.map((x) => (
              <div key={x.t} className="sr grid gap-2 border-t border-line py-7 sm:grid-cols-[0.9fr_1.1fr] sm:gap-8">
                <dt className="font-display text-[1.5rem] font-semibold leading-snug tracking-[-0.015em]">{x.t}</dt>
                <dd className="leading-relaxed text-ink-2">{x.d}</dd>
              </div>
            ))}
          </dl>
        </Wrap>
      </section>

      {/* Lộ trình trở thành HLV trên Gymini — dùng lại Đường tiến */}
      <section className="bg-sunk py-24 sm:py-32">
        <Wrap>
          <Kicker>Bắt đầu thế nào</Kicker>
          <h2 className="t-h2 sr mt-4 max-w-[16ch]">Từ hồ sơ tới buổi dạy đầu tiên.</h2>
          <div className="relative mt-16 hidden h-[120px] lg:block">
            <ProgressLine mode="static" nodes={STEPS.map((_, i) => ({ x: 0.1 + i * 0.2, y: 0.85 - i * 0.16 }))} start={{ x: 0, y: 0.92 }} end={{ x: 1, y: 0.12 }}
              nodeFill="var(--bg-sunk)" strokeWidth={2.5} />
          </div>
          <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:mt-6 lg:grid-cols-5 lg:gap-6">
            {STEPS.map((s, i) => (
              <li key={s.t} className="sr">
                <p className="tnum font-display text-[1rem] font-semibold text-accent-text">Bước {i + 1}</p>
                <p className="mt-2 font-display text-[1.4rem] font-semibold tracking-[-0.01em]">{s.t}</p>
                <p className="mt-2 leading-relaxed text-ink-2">{s.d}</p>
              </li>
            ))}
          </ol>
        </Wrap>
      </section>

      {/* Luật chơi */}
      <section className="py-24 sm:py-32">
        <Wrap className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Kicker>Minh bạch với cả hai bên</Kicker>
            <h2 className="t-h2 sr mt-4 max-w-[12ch]">Chốt từ đầu, không sửa giữa chừng.</h2>
          </div>
          <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {[
              "Số buổi và giá cố định khi hợp đồng bắt đầu.",
              "Tỷ lệ chia doanh thu ghi lên hợp đồng lúc thanh toán.",
              "Khách thanh toán qua VNPay hoặc ZaloPay.",
              "Vắng buổi thì khách được bù buổi, ghi rõ trên hợp đồng.",
              "Mỗi khách tập cùng lúc tối đa hai huấn luyện viên.",
              "Gói trực tiếp tại phòng gym cần khách có gói hội viên còn hạn ở đó.",
            ].map((r) => (
              <li key={r} className="sr flex gap-3 border-t border-line pt-5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text"><CheckIcon size={13} weight="bold" aria-hidden="true" /></span>
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        </Wrap>
      </section>

      <FinalCta title="Hồ sơ của bạn là bước đầu tiên." body="Tạo tài khoản, nộp hồ sơ huấn luyện viên và chờ duyệt. Sau đó bạn đăng gói và mở lịch." cta={{ href: APP.register, label: "Đăng ký làm huấn luyện viên" }} />
    </>
  );
}
