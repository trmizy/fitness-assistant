import { Link } from "react-router";
import { Wrap } from "../../components/public-site/ui";

export function NotFoundPage() {
  return (
    <section className="pb-32 pt-[160px]">
      <Wrap>
        <p className="text-ps-ink-3">Lỗi 404</p>
        <h1 className="ps-t-display mt-4 max-w-[14ch]">Trang này không có trong lộ trình.</h1>
        <Link to="/" className="ps-btn ps-btn-primary mt-10">Về trang chủ</Link>
      </Wrap>
    </section>
  );
}
