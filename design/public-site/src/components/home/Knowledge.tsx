import { Link } from "react-router";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { ARTICLES } from "../../data/articles";
import { Kicker, Photo, Wrap } from "../ui";

export function Knowledge() {
  const [featured, ...rest] = ARTICLES;
  return (
    <section className="py-24 sm:py-32">
      <Wrap>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Kicker>Kiến thức</Kicker>
            <h2 className="t-h2 sr mt-4 max-w-[16ch]">Hiểu cơ thể mình trước khi tập nặng hơn.</h2>
          </div>
          <Link to="/kien-thuc" className="btn btn-secondary self-start sm:self-auto">Tất cả bài viết <ArrowRightIcon size={18} weight="bold" aria-hidden="true" /></Link>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[1.35fr_1fr] lg:gap-14">
          <Link to={`/kien-thuc/${featured.slug}`} className="group sr block">
            <Photo name={featured.image} alt={featured.imageAlt} w={800} h={1200} pos="50% 35%"
              className="aspect-[16/11] rounded-[28px] bg-sunk" imgClassName="zoom-img" sizesAttr="(min-width: 1024px) 55vw, 100vw" />
            <p className="mt-6 text-[0.92rem] font-medium text-accent-text">{featured.category} · {featured.minutes} phút đọc</p>
            <h3 className="t-h3 mt-2 max-w-[24ch] text-[clamp(1.6rem,1.2rem+1.3vw,2.4rem)]"><span className="link-u">{featured.title}</span></h3>
            <p className="mt-3 max-w-[56ch] leading-relaxed text-ink-2">{featured.excerpt}</p>
          </Link>

          <ul className="grid content-start">
            {rest.map((a) => (
              <li key={a.slug} className="border-b border-line first:border-t">
                <Link to={`/kien-thuc/${a.slug}`} className="group grid grid-cols-[1fr_112px] items-center gap-5 py-6 sm:grid-cols-[1fr_136px]">
                  <div className="min-w-0">
                    <p className="text-[0.88rem] font-medium text-accent-text">{a.category} · {a.minutes} phút</p>
                    <h3 className="mt-1.5 font-display text-[1.3rem] font-semibold leading-snug tracking-[-0.01em]"><span className="link-u">{a.title}</span></h3>
                  </div>
                  <Photo name={a.image} alt="" w={800} h={1200} className="aspect-square rounded-[18px] bg-sunk" imgClassName="zoom-img" sizesAttr="136px" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-8 text-[0.85rem] text-ink-3">Bài viết mẫu cho bản thiết kế, cần chuyên gia duyệt trước khi phát hành.</p>
      </Wrap>
    </section>
  );
}
