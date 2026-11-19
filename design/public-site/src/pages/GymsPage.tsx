import { useEffect } from "react";
import { CheckIcon, MinusIcon, QrCodeIcon } from "@phosphor-icons/react";
import { FinalCta } from "../components/home/FinalCta";
import { MaskTitle } from "../components/MaskTitle";
import { APP, Btn, ConceptTag, Kicker, Photo, Wrap } from "../components/ui";

/** Ma trận quyền — lấy đúng theo partner-permissions (HANDBOOK §2.1). */
const ROLES = ["Chủ phòng gym", "Quản lý", "Lễ tân", "Kế toán"];
const MATRIX: { k: string; v: (boolean | string)[] }[] = [
  { k: "Sửa thương hiệu, chi nhánh, gói; mời nhân sự; rút tiền", v: [true, false, false, false] },
  { k: "Xem chi nhánh, gói và giá", v: [true, true, "Rút gọn", true] },
  { k: "Danh sách hội viên và check-in", v: [true, "Theo chi nhánh", false, false] },
];

const STEPS = [
  { t: "Nhập email, đặt mật khẩu", d: "Gymini gửi đường dẫn xác nhận tới email của bạn." },
  { t: "Điền hồ sơ đối tác", d: "Người đại diện, thương hiệu, chi nhánh đầu tiên, vị trí trên bản đồ, ảnh cơ sở." },
  { t: "Nộp giấy tờ", d: "Giấy phép kinh doanh, giấy tờ người đại diện, giấy tờ chứng minh mặt bằng." },
  { t: "Gymini thẩm định", d: "Kiểm tra từng giấy tờ và báo lại nếu cần bổ sung." },
  { t: "Mở bán", d: "Tạo gói hội viên, thêm chi nhánh và mời đội ngũ." },
];

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-accent-text"><CheckIcon size={14} weight="bold" aria-label="Có" /></span>;
  if (v === false) return <span className="inline-grid h-7 w-7 place-items-center rounded-full text-ink-3"><MinusIcon size={14} weight="bold" aria-label="Không" /></span>;
  return <span className="text-[0.85rem] font-medium text-ink-2">{v}</span>;
}

export function GymsPage() {
  useEffect(() => { document.title = "Dành cho phòng gym — Gymini"; }, []);
  return (
    <>
      {/* Hero: ảnh lớn, chữ đặt trên lớp phủ đủ tương phản */}
      <section className="pt-[88px] sm:pt-[96px]">
        <div className="px-[max(8px,1vw)]">
          <div className="relative isolate mx-auto max-w-[1600px] overflow-hidden rounded-[28px] bg-band text-band-ink sm:rounded-[40px]">
            <Photo name="gyms-hero" sizes={[1000, 1920]} alt="Không gian phòng gym rộng với khu máy tập" w={1920} h={1440} eager className="absolute inset-0 -z-10 h-full" sizesAttr="100vw" pos="50% 60%" />
            <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,10,10,0.88)_0%,rgba(10,10,10,0.62)_55%,rgba(10,10,10,0.3)_100%)]" aria-hidden="true" />
            <div className="wrap flex min-h-[min(760px,88dvh)] flex-col justify-end py-14 sm:py-20">
              <div className="enter"><Kicker onDark>Dành cho phòng gym</Kicker></div>
              <MaskTitle lines={["Vận hành phòng gym", "trên một hệ thống."]} className="t-display mt-6 max-w-[14ch]" />
              <p className="enter mt-7 max-w-[46ch] text-[1.15rem] leading-relaxed text-[#d4d4d8]" style={{ ["--d" as string]: 480 }}>
                Một hoặc nhiều chi nhánh. Bán gói hội viên online, vào cửa bằng mã QR, phân quyền cho đội ngũ và hợp tác với huấn luyện viên độc lập.
              </p>
              <div className="enter mt-9 flex flex-wrap gap-3" style={{ ["--d" as string]: 600 }}>
                <Btn href={APP.partnerApply} variant="on-dark" arrow>Đăng ký đối tác</Btn>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bảng điều hành minh hoạ + ma trận quyền thật */}
      <section className="py-24 sm:py-32">
        <Wrap>
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
            <div>
              <Kicker>Vận hành hằng ngày</Kicker>
              <h2 className="t-h2 sr mt-4 max-w-[14ch]">Mỗi người một quyền, rõ ràng.</h2>
            </div>
            <p className="t-lead sr max-w-[44ch] lg:justify-self-end">Tiền và nhân sự chỉ chủ phòng gym làm được. Quản lý, lễ tân và kế toán thấy đúng phần việc của mình.</p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="sr rounded-[28px] border border-line bg-elev p-6 sm:p-8">
              <div className="flex items-center justify-between"><p className="font-display text-[1.2rem] font-semibold">Check-in hôm nay</p><ConceptTag /></div>
              <p className="tnum mt-6 font-display text-[clamp(4rem,3rem+3vw,6rem)] font-semibold leading-none tracking-[-0.04em]">148</p>
              <p className="mt-2 text-ink-3">Chi nhánh Quận 3 · tới 17:42</p>
              <div className="mt-8 flex items-center gap-4 rounded-2xl bg-sunk p-4">
                <span className="grid h-14 w-14 place-items-center rounded-xl bg-elev text-ink"><QrCodeIcon size={30} aria-hidden="true" /></span>
                <p className="text-[0.95rem] leading-snug text-ink-2">Mỗi chi nhánh một mã QR. Lễ tân có thể check-in hộ tại quầy.</p>
              </div>
            </div>
            <div className="sr overflow-hidden rounded-[28px] border border-line bg-elev">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <caption className="sr-only">Quyền của từng vai trò trong một phòng gym</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="px-6 py-5 text-[0.9rem] font-medium text-ink-3">Việc</th>
                      {ROLES.map((r) => <th key={r} scope="col" className="px-3 py-5 text-center text-[0.9rem] font-semibold">{r}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {MATRIX.map((m) => (
                      <tr key={m.k} className="border-b border-line last:border-0">
                        <th scope="row" className="max-w-[260px] px-6 py-5 font-normal leading-snug text-ink">{m.k}</th>
                        {m.v.map((v, i) => <td key={i} className="px-3 py-5 text-center"><Cell v={v} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Wrap>
      </section>

      {/* Quy trình mở bán */}
      <section className="bg-band py-24 text-band-ink sm:py-32">
        <Wrap className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-[120px] lg:self-start">
            <Kicker onDark>Từ email tới ngày mở bán</Kicker>
            <h2 className="t-h2 sr mt-4 max-w-[12ch]">Đăng ký không cần gọi điện hẹn lịch.</h2>
            <p className="sr mt-6 max-w-[40ch] text-[1.1rem] leading-relaxed text-band-muted">Phòng gym chỉ hiện trên Gymini sau khi giấy tờ được thẩm định.</p>
          </div>
          <ol className="grid">
            {STEPS.map((s, i) => (
              <li key={s.t} className="sr grid grid-cols-[4.5rem_1fr] gap-4 border-t border-band-line py-8">
                <span className="tnum font-display text-[2.6rem] font-semibold leading-none tracking-[-0.03em] text-band-accent">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-display text-[1.5rem] font-semibold tracking-[-0.01em]">{s.t}</p>
                  <p className="mt-2 max-w-[48ch] leading-relaxed text-band-muted">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </Wrap>
      </section>

      <FinalCta title="Chi nhánh đầu tiên bắt đầu từ một email." body="Điền hồ sơ đối tác, nộp giấy tờ và chờ thẩm định. Sau đó bạn mở bán gói hội viên ngay trên Gymini." cta={{ href: APP.partnerApply, label: "Đăng ký đối tác" }} />
    </>
  );
}
