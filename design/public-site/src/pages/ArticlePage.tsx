import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { ARTICLES, findArticle } from "../data/articles";
import { MaskTitle } from "../components/MaskTitle";
import { APP, Btn, Photo, Wrap } from "../components/ui";
import { NotFoundPage } from "./NotFoundPage";

export function ArticlePage() {
  const { slug } = useParams();
  const a = findArticle(slug);
  useEffect(() => { if (a) document.title = `${a.title} — Gymini`; }, [a]);
  if (!a) return <NotFoundPage />;
  const related = ARTICLES.filter((x) => x.slug !== a.slug).slice(0, 2);

  return (
    <article>
      <header className="pt-[116px] sm:pt-[140px]">
        <Wrap className="max-w-[1100px]">
          <Link to="/kien-thuc" className="group enter inline-flex items-center gap-2 text-[0.95rem] font-medium text-ink-2 hover:text-ink">
            <ArrowLeftIcon size={16} weight="bold" className="transition-transform duration-[350ms] group-hover:-translate-x-1" aria-hidden="true" />
            Kiến thức
          </Link>
          <p className="enter mt-8 text-[0.95rem] font-medium text-accent-text" style={{ ["--d" as string]: 80 }}>{a.category} · {a.minutes} phút đọc</p>
          <MaskTitle key={a.slug} lines={[a.title]} className="t-display mt-4 text-[clamp(2.3rem,1.3rem+4vw,4.6rem)]" />
          <p className="t-lead enter mt-6 max-w-[52ch]" style={{ ["--d" as string]: 380 }}>{a.excerpt}</p>
        </Wrap>
      </header>

      <div className="mt-12 px-[max(8px,1vw)]">
        <Photo key={a.slug} name={a.image} alt={a.imageAlt} w={1400} h={2100} eager pos="50% 35%"
          className="enter mx-auto aspect-[16/8] max-w-[1400px] rounded-[28px] bg-sunk sm:rounded-[40px]" sizes={[800, 1400]} sizesAttr="100vw" />
        <p className="wrap mx-auto mt-3 max-w-[1400px] text-[0.82rem] text-ink-3">Ảnh: {a.credit}. Ảnh lấy từ Internet, chỉ dùng cho bản demo khoá luận.</p>
      </div>

      <Wrap className="max-w-[1100px]">
        <div className="mx-auto mt-16 max-w-[68ch]">
          <div className="prose-gym">
            {a.body.map((b, i) => (
              <div key={i}>
                {b.h && <h2>{b.h}</h2>}
                {b.p && <p>{b.p}</p>}
                {b.list && <ul>{b.list.map((li) => <li key={li}>{li}</li>)}</ul>}
              </div>
            ))}
          </div>
          <aside className="mt-12 rounded-[24px] border border-line bg-elev p-6 sm:p-8" aria-label="Trong ứng dụng Gymini">
            <p className="font-display text-[1.25rem] font-semibold">Trong Gymini</p>
            <p className="mt-2 leading-relaxed text-ink-2">{a.inGymini}</p>
            <Btn href={APP.register} arrow className="mt-6">Bắt đầu lộ trình</Btn>
          </aside>
          <p className="mt-8 text-[0.85rem] text-ink-3">Bài viết mẫu, mang tính phổ thông, không thay thế tư vấn y tế. Cần chuyên gia duyệt trước khi phát hành.</p>
        </div>
      </Wrap>

      <section className="mt-24 border-t border-line py-20">
        <Wrap>
          <h2 className="t-h3">Đọc tiếp</h2>
          <ul className="mt-8 grid gap-8 md:grid-cols-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link to={`/kien-thuc/${r.slug}`} className="group grid grid-cols-[120px_1fr] items-center gap-5 sm:grid-cols-[180px_1fr]">
                  <Photo name={r.image} alt="" w={800} h={1200} className="aspect-[4/3] rounded-[18px] bg-sunk" imgClassName="zoom-img" sizesAttr="180px" />
                  <div>
                    <p className="text-[0.88rem] font-medium text-accent-text">{r.category}</p>
                    <p className="mt-1 font-display text-[1.3rem] font-semibold leading-snug tracking-[-0.01em]"><span className="link-u">{r.title}</span></p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Wrap>
      </section>
    </article>
  );
}
