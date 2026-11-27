import CountUp from "../reactbits/CountUp";
import { Kicker, Wrap } from "../ui";

/** Con số là LUẬT trong hệ thống (đối chiếu mã/HANDBOOK), không phải số liệu tăng trưởng. */
const RULES = [
  { n: 2, unit: "huấn luyện viên", text: "Tối đa cùng lúc cho mỗi người tập. Lịch các buổi không được chồng nhau." },
  { n: 12, unit: "giờ", text: "Để thanh toán sau khi huấn luyện viên nhận yêu cầu. Quá hạn, yêu cầu tự huỷ." },
  { n: 3, unit: "loại giấy tờ", text: "Phòng gym phải nộp để được thẩm định: giấy phép kinh doanh, giấy tờ người đại diện, giấy tờ mặt bằng." },
  { n: 5, unit: "quyết định", text: "Có thể có ở cuối mỗi chu kỳ, từ Giữ tới Xây lại, kèm lời giải thích." },
];

export function Rules() {
  return (
    <section className="bg-ps-sunk py-24 sm:py-32">
      <Wrap>
        <Kicker>Luật chơi rõ ràng</Kicker>
        <h2 className="ps-t-h2 ps-sr mt-4 max-w-[18ch]">Những con số được chốt từ đầu, không ai sửa giữa chừng.</h2>
        <dl className="mt-16 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {RULES.map((r) => (
            <div key={r.unit} className="ps-sr border-t border-ps-line-strong pt-6">
              <dt>
                <span className="ps-tnum block font-ps-display text-[clamp(4rem,2.5rem+5vw,7rem)] font-semibold leading-[0.9] tracking-[-0.04em] text-ps-ink">
                  <CountUp to={r.n} duration={1.2} trigger="view" />
                </span>
                <span className="mt-3 block font-ps-display text-[1.35rem] font-semibold tracking-[-0.01em]">{r.unit}</span>
              </dt>
              <dd className="mt-3 max-w-[30ch] leading-relaxed text-ps-ink-2">{r.text}</dd>
            </div>
          ))}
        </dl>
      </Wrap>
    </section>
  );
}
