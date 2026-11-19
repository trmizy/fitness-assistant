import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, CheckIcon, QrCodeIcon, VideoCameraIcon } from "@phosphor-icons/react";
import { ConceptTag, Kicker, Photo, Wrap } from "../ui";

/* ── Màn minh hoạ theo vai trò (dữ liệu ví dụ, tên hư cấu) ───────── */
function UiClient() {
  const pts = [
    { i: "GH", n: "Trần Gia Huy", t: "Tăng cơ · Trực tiếp", p: "12 buổi · 60 phút" },
    { i: "TV", n: "Lê Thảo Vy", t: "Giảm mỡ · Online", p: "8 buổi · 45 phút" },
  ];
  return (
    <div>
      <p className="font-display text-[1.15rem] font-semibold">Tìm huấn luyện viên</p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[0.8rem]">
        {["Trực tiếp", "Online", "Tăng cơ", "Giảm mỡ"].map((c, i) => (
          <span key={c} className={`rounded-full px-2.5 py-1 font-medium ${i === 0 ? "bg-ink text-bg" : "bg-sunk text-ink-2"}`}>{c}</span>
        ))}
      </div>
      <div className="mt-3 grid gap-2">
        {pts.map((p) => (
          <div key={p.n} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.85rem] font-semibold text-accent-text">{p.i}</span>
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{p.n}</p><p className="truncate text-[0.8rem] text-ink-3">{p.t}</p></div>
            <span className="hidden text-[0.8rem] text-ink-2 sm:block">{p.p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function UiTrainer() {
  const ss = [
    { h: "06:30", c: "Ngọc Anh", m: "Trực tiếp", left: "Còn 7/12 buổi" },
    { h: "12:15", c: "Đức Minh", m: "Online", left: "Còn 3/8 buổi" },
    { h: "18:00", c: "Bảo Trâm", m: "Trực tiếp", left: "Còn 10/12 buổi" },
  ];
  return (
    <div>
      <p className="font-display text-[1.15rem] font-semibold">Lịch hôm nay</p>
      <div className="mt-3 grid gap-2">
        {ss.map((s) => (
          <div key={s.h} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
            <span className="tnum w-12 shrink-0 font-semibold">{s.h}</span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{s.c}</p><p className="text-[0.8rem] text-ink-3">{s.left}</p></div>
            <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[0.75rem] text-ink-2">
              {s.m === "Online" && <VideoCameraIcon size={12} aria-hidden="true" />}{s.m}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function UiGym() {
  const rows = [{ t: "17:42", n: "Hội viên · gói 3 tháng" }, { t: "17:39", n: "Hội viên · gói 12 tháng" }, { t: "17:31", n: "Huấn luyện viên · có buổi trực tiếp" }];
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-display text-[1.15rem] font-semibold">Check-in hôm nay</p><p className="text-[0.8rem] text-ink-3">Chi nhánh Quận 3</p></div>
        <p className="tnum font-display text-[2rem] font-semibold leading-none">148</p>
      </div>
      <div className="mt-3 grid gap-2">
        {rows.map((r) => (
          <div key={r.t} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent-text"><QrCodeIcon size={16} aria-hidden="true" /></span>
            <p className="min-w-0 flex-1 truncate text-[0.9rem]">{r.n}</p>
            <span className="tnum text-[0.8rem] text-ink-3">{r.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ACTORS = [
  {
    key: "nguoi-tap", tab: "Người tập", title: "Có kế hoạch, có người kèm khi cần.",
    body: "Bắt đầu với lộ trình tập và ăn theo chu kỳ. Khi muốn có người kèm, bạn chọn huấn luyện viên theo hình thức, mục tiêu và lịch trống.",
    points: ["Lộ trình tập và ăn theo chu kỳ khoảng bốn tuần", "Chọn huấn luyện viên online hoặc trực tiếp", "Mua gói hội viên phòng gym qua VNPay, ZaloPay", "Tập cùng lúc tối đa hai huấn luyện viên"],
    photo: { name: "eco-nguoi-tap", w: 800, h: 1198, alt: "Dexter Jackson, Mr. Olympia 2008, tạo dáng trên sân khấu", pos: "50% 22%", credit: "Dexter Jackson, Mr. Olympia 2008" },
    Ui: UiClient, link: null as null | { to: string; label: string },
  },
  {
    key: "hlv", tab: "Huấn luyện viên", title: "Dạy độc lập, theo cách của bạn.",
    body: "Bạn không phải nhân viên của phòng gym nào. Bạn tự đặt gói, giá và lịch; Gymini giữ hợp đồng, buổi tập và thanh toán rõ ràng cho cả hai bên.",
    points: ["Tự tạo gói: số buổi, thời lượng, giá, hình thức", "Theo dõi lộ trình và tiến độ của từng học viên", "Hợp tác dạy trực tiếp tại phòng gym nếu muốn", "Hồ sơ được duyệt trước khi hiển thị"],
    photo: { name: "eco-hlv", w: 800, h: 1162, alt: "Arnold Schwarzenegger tạo dáng năm 1974, ảnh đen trắng", pos: "50% 2%", credit: "Arnold Schwarzenegger, 1974" },
    Ui: UiTrainer, link: { to: "/huan-luyen-vien", label: "Dành cho huấn luyện viên" },
  },
  {
    key: "phong-gym", tab: "Chủ phòng gym", title: "Vận hành chi nhánh trên một hệ thống.",
    body: "Bán gói hội viên online, cho hội viên vào cửa bằng mã QR, phân quyền cho quản lý, lễ tân và kế toán.",
    points: ["Gói hội viên theo ngày, có thể giới hạn lượt", "Check-in QR riêng cho từng chi nhánh", "Việc liên quan tới tiền và nhân sự chỉ chủ phòng gym làm", "Thẩm định giấy tờ trước khi mở bán"],
    photo: { name: "eco-phong", w: 800, h: 534, alt: "Không gian phòng gym sáng với máy chạy bộ và máy tập", pos: "50% 50%", credit: "" },
    Ui: UiGym, link: { to: "/phong-gym", label: "Dành cho phòng gym" },
  },
];

export function Ecosystem() {
  const [a, setA] = useState(0);
  const pill = useRef<HTMLSpanElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const moved = useRef(false);

  const place = (animate: boolean) => {
    const p = pill.current, t = tabs.current[a];
    if (!p || !t) return;
    if (!animate) p.style.transition = "none";
    p.style.transform = `translateX(${t.offsetLeft}px)`; p.style.width = `${t.offsetWidth}px`;
    if (!animate) { void p.offsetWidth; p.style.transition = ""; }
  };
  useLayoutEffect(() => place(moved.current), [a]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const r = () => place(false);
    window.addEventListener("resize", r); document.fonts?.ready.then(r);
    return () => window.removeEventListener("resize", r);
  });

  const [prev, setPrev] = useState(-1);
  const choose = (i: number) => { if (i === a) return; moved.current = true; setPrev(a); setA(i); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (a + (e.key === "ArrowRight" ? 1 : ACTORS.length - 1)) % ACTORS.length;
    choose(n); tabs.current[n]?.focus();
  };
  const x = ACTORS[a];

  return (
    <section id="he-sinh-thai" className="scroll-mt-24 py-24 sm:py-32">
      <Wrap>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Kicker>Một hệ sinh thái, ba vai trò</Kicker>
            <h2 className="t-h2 sr mt-4 max-w-[15ch]">Người tập, huấn luyện viên và phòng gym gặp nhau ở đây.</h2>
          </div>
          <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
            <div className="seg" role="tablist" aria-label="Chọn vai trò" onKeyDown={onKey}>
              <span ref={pill} className="seg-pill" aria-hidden="true" />
              {ACTORS.map((y, i) => (
                <button key={y.key} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`eco-${y.key}`}
                  aria-selected={i === a} aria-controls="eco-panel" tabIndex={i === a ? 0 : -1} className="seg-tab" onClick={() => choose(i)}>
                  {y.tab}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div id="eco-panel" role="tabpanel" aria-labelledby={`eco-${x.key}`} className="mt-12 grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-14">
          {/* Media + màn minh hoạ */}
          <div className="relative">
            <div className="relative isolate aspect-[4/3.4] overflow-hidden rounded-[28px] bg-sunk sm:rounded-[36px]">
              {/* Ảnh mới mở ra PHÍA TRÊN ảnh vừa xem (không lộ nền trống khi chuyển). Ảnh đã tải được giữ lại. */}
              {ACTORS.map((y, i) => (
                <div key={y.key} aria-hidden={i !== a}
                  className={`absolute inset-0 ${i === a ? `z-20 ${moved.current ? "photo-in" : ""}` : i === prev ? "z-10" : "invisible z-0"}`}>
                  <Photo name={y.photo.name} alt={i === a ? y.photo.alt : ""} w={y.photo.w} h={y.photo.h} pos={y.photo.pos} className="h-full" sizesAttr="(min-width: 1024px) 55vw, 100vw" />
                  {y.photo.credit && <p className="absolute right-4 top-4 rounded-full bg-black/60 px-3 py-1 text-[0.78rem] font-medium text-white">Ảnh: {y.photo.credit}</p>}
                </div>
              ))}
            </div>
            <div key={`ui-${x.key}`} className="swap-in relative z-10 -mt-24 ml-4 mr-4 rounded-[22px] border border-line bg-elev p-4 sm:-mt-32 sm:ml-8 sm:mr-auto sm:max-w-[380px] sm:p-5"
              style={{ ["--d" as string]: 160, boxShadow: "0 30px 60px -30px rgb(var(--shadow) / 0.4)" }}>
              <div className="mb-3 flex justify-end"><ConceptTag /></div>
              <x.Ui />
            </div>
          </div>

          {/* Nội dung */}
          <div key={`txt-${x.key}`} className="swap-in flex flex-col justify-center" style={{ ["--d" as string]: 60 }}>
            <h3 className="t-h3 text-[clamp(1.7rem,1.2rem+1.5vw,2.5rem)]">{x.title}</h3>
            <p className="mt-4 max-w-[46ch] text-[1.08rem] leading-relaxed text-ink-2">{x.body}</p>
            <ul className="mt-7 grid gap-3.5">
              {x.points.map((p) => (
                <li key={p} className="flex gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text"><CheckIcon size={13} weight="bold" aria-hidden="true" /></span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            {x.link && (
              <Link to={x.link.to} className="group mt-9 inline-flex items-center gap-2 self-start font-semibold text-accent-text">
                <span className="link-u">{x.link.label}</span>
                <ArrowRightIcon size={18} weight="bold" className="transition-transform duration-[350ms] group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </Wrap>
    </section>
  );
}
