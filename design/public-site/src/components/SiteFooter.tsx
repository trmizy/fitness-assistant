import { Link } from "react-router";
import { Wrap } from "./ui";

/** Footer tối, nối liền phần CTA cuối. Wordmark lớn làm điểm kết thị giác. */
export function SiteFooter() {
  return (
    <footer className="bg-band text-band-ink">
      <Wrap className="grid gap-12 border-t border-band-line py-16 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="max-w-xs">
          <p className="font-display text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]">Lộ trình tập, người kèm và nơi để tập.</p>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-band-muted">Một ứng dụng cho người tập, huấn luyện viên độc lập và phòng gym tại Việt Nam.</p>
        </div>
        <nav aria-label="Sản phẩm" className="flex flex-col gap-3 text-[0.95rem]">
          <p className="font-semibold">Sản phẩm</p>
          <Link to="/#cach-hoat-dong" className="text-band-muted hover:text-band-ink">Cách hoạt động</Link>
          <Link to="/huan-luyen-vien" className="text-band-muted hover:text-band-ink">Cho huấn luyện viên</Link>
          <Link to="/phong-gym" className="text-band-muted hover:text-band-ink">Cho phòng gym</Link>
        </nav>
        <nav aria-label="Kiến thức" className="flex flex-col gap-3 text-[0.95rem]">
          <p className="font-semibold">Kiến thức</p>
          <Link to="/kien-thuc" className="text-band-muted hover:text-band-ink">Tất cả bài viết</Link>
          <Link to="/kien-thuc/rpe-la-gi" className="text-band-muted hover:text-band-ink">RPE là gì</Link>
          <Link to="/kien-thuc/doc-phieu-inbody" className="text-band-muted hover:text-band-ink">Đọc phiếu InBody</Link>
        </nav>
        <div className="flex flex-col gap-3 text-[0.95rem]">
          <p className="font-semibold">Thông tin</p>
          <p className="text-band-muted">Điều khoản sử dụng <span className="text-[0.8rem]">(đang soạn)</span></p>
          <p className="text-band-muted">Chính sách quyền riêng tư <span className="text-[0.8rem]">(đang soạn)</span></p>
          <a href="https://gymini.vn/login" className="text-band-muted hover:text-band-ink">Đăng nhập ứng dụng</a>
        </div>
      </Wrap>
      <Wrap className="overflow-hidden">
        <p aria-hidden="true" className="select-none font-display font-bold leading-[0.8] tracking-[-0.05em] text-band-elev"
          style={{ fontSize: "clamp(5rem, 24vw, 22rem)" }}>
          gymini
        </p>
      </Wrap>
      <Wrap className="flex flex-col gap-2 border-t border-band-line py-6 text-[0.85rem] text-band-muted sm:flex-row sm:justify-between">
        <p>© 2026 Gymini · Bản thiết kế, chưa phát hành</p>
        <p>Nội dung không thay thế tư vấn của bác sĩ hay chuyên gia dinh dưỡng.</p>
      </Wrap>
    </footer>
  );
}
