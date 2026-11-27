import { Link } from "react-router";
import { ARTICLES } from "../../components/public-site/data/articles";
import { MaskTitle } from "../../components/public-site/MaskTitle";
import { usePageMeta } from "../../components/public-site/usePageMeta";
import { Kicker, Photo, Wrap } from "../../components/public-site/ui";

export function KnowledgePage() {
  usePageMeta("Kiến thức — Gymini", "Bài viết ngắn về tập luyện, phục hồi, số đo cơ thể và cách chọn huấn luyện viên.");
  const [featured, ...rest] = ARTICLES;
  return (
    <>
      <section className="pt-[120px] sm:pt-[150px]">
        <Wrap>
          <div className="ps-enter"><Kicker>Kiến thức</Kicker></div>
          <MaskTitle lines={["Tập thông minh hơn,", "không phải nặng hơn."]} className="ps-t-display mt-6 max-w-[16ch]" />
          <p className="ps-t-lead ps-enter mt-7 max-w-[50ch]" style={{ ["--d" as string]: 420 }}>Bài viết ngắn về tập luyện, phục hồi, số đo cơ thể và cách chọn huấn luyện viên.</p>
        </Wrap>
      </section>

      <section className="pb-12 pt-16 sm:pt-20">
        <Wrap>
          <Link to={`/kien-thuc/${featured.slug}`} className="group ps-enter grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-14" style={{ ["--d" as string]: 520 }}>
            <Photo name={featured.image} alt={featured.imageAlt} w={800} h={1200} eager pos="50% 35%" className="aspect-[16/10] rounded-[32px] bg-ps-sunk" imgClassName="ps-zoom-img" sizesAttr="(min-width: 1024px) 58vw, 100vw" />
            <div>
              <p className="text-[0.95rem] font-medium text-ps-accent-text">Nổi bật · {featured.category} · {featured.minutes} phút đọc</p>
              <h2 className="ps-t-h2 mt-3 text-[clamp(2rem,1.3rem+2.4vw,3.4rem)]"><span className="ps-link-u">{featured.title}</span></h2>
              <p className="mt-4 max-w-[46ch] text-[1.1rem] leading-relaxed text-ps-ink-2">{featured.excerpt}</p>
            </div>
          </Link>
        </Wrap>
      </section>

      <section className="pb-28 pt-12">
        <Wrap>
          <ul className="grid gap-x-8 gap-y-14 border-t border-ps-line pt-14 md:grid-cols-3">
            {rest.map((a) => (
              <li key={a.slug} className="ps-sr">
                <Link to={`/kien-thuc/${a.slug}`} className="group block">
                  <Photo name={a.image} alt={a.imageAlt} w={800} h={1200} pos="50% 35%" className="aspect-[4/3] rounded-[24px] bg-ps-sunk" imgClassName="ps-zoom-img" sizesAttr="(min-width: 768px) 32vw, 100vw" />
                  <p className="mt-5 text-[0.9rem] font-medium text-ps-accent-text">{a.category} · {a.minutes} phút</p>
                  <h3 className="mt-2 font-ps-display text-[1.5rem] font-semibold leading-snug tracking-[-0.015em]"><span className="ps-link-u">{a.title}</span></h3>
                  <p className="mt-2 leading-relaxed text-ps-ink-2">{a.excerpt}</p>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-12 text-[0.85rem] text-ps-ink-3">Bài viết mẫu cho bản thiết kế, cần chuyên gia duyệt trước khi phát hành.</p>
        </Wrap>
      </section>
    </>
  );
}
