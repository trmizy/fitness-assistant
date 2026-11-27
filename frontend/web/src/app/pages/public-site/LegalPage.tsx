import { Link } from "react-router";
import type { LegalDoc } from "../../components/public-site/data/legal";
import { LEGAL_DOCS, PRIVACY, TERMS } from "../../components/public-site/data/legal";
import { MaskTitle } from "../../components/public-site/MaskTitle";
import { Kicker, Wrap } from "../../components/public-site/ui";
import { usePageMeta } from "../../components/public-site/usePageMeta";

/** Trang pháp lý: mục lục bên trái (desktop), nội dung đọc dài bên phải. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  usePageMeta(`${doc.title} — Gymini`, doc.lead);
  const other = LEGAL_DOCS.find((d) => d.slug !== doc.slug)!;
  const id = (i: number) => `muc-${i + 1}`;

  return (
    <>
      <section className="pt-[120px] sm:pt-[150px]">
        <Wrap>
          <div className="ps-enter"><Kicker>Thông tin pháp lý</Kicker></div>
          <MaskTitle key={doc.slug} lines={[doc.title]} className="ps-t-display mt-6 max-w-[16ch] text-[clamp(2.4rem,1.4rem+4vw,4.8rem)]" />
          <p className="ps-t-lead ps-enter mt-6 max-w-[56ch]" style={{ ["--d" as string]: 380 }}>{doc.lead}</p>
          <p className="ps-enter mt-6 inline-flex rounded-full bg-ps-accent-soft px-3 py-1 text-[0.85rem] font-medium text-ps-accent-text" style={{ ["--d" as string]: 460 }}>
            {doc.updated}
          </p>
        </Wrap>
      </section>

      <section className="pb-28 pt-16">
        <Wrap className="grid gap-12 lg:grid-cols-[240px_1fr] lg:gap-16">
          <nav aria-label="Mục lục" className="hidden lg:block">
            <ol className="sticky top-[110px] grid gap-1 border-l border-ps-line">
              {doc.sections.map((s, i) => (
                <li key={s.h}>
                  <a href={`#${id(i)}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-[0.92rem] text-ps-ink-2 hover:border-ps-ink hover:text-ps-ink">{s.h}</a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="ps-prose max-w-[68ch]">
            {doc.sections.map((s, i) => (
              <section key={s.h} id={id(i)} className="scroll-mt-28">
                <h2 className={i === 0 ? "!mt-0" : ""}>{s.h}</h2>
                {s.p?.map((t) => <p key={t}>{t}</p>)}
                {s.list && <ul>{s.list.map((t) => <li key={t}>{t}</li>)}</ul>}
              </section>
            ))}
            <p className="mt-12 border-t border-ps-line pt-6 text-[0.95rem]">
              Xem thêm: <Link to={`/${other.slug}`} className="font-semibold text-ps-accent-text underline-offset-4 hover:underline">{other.title}</Link>
            </p>
          </div>
        </Wrap>
      </section>
    </>
  );
}

export function TermsPage() {
  return <LegalPage doc={TERMS} />;
}

export function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}
