import { Link } from "react-router";
import { Wrap } from "./ui";

/** Footer tối, nối liền phần CTA cuối. Wordmark lớn làm điểm kết thị giác. */
export function SiteFooter() {
  return (
    <footer className="bg-ps-band text-ps-band-ink">
      <Wrap className="grid gap-12 border-t border-ps-band-line py-16 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="max-w-xs">
          <p className="font-ps-display text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]">Lộ trình tập, người kèm và nơi để tập.</p>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ps-band-muted">Một ứng dụng cho người tập, huấn luyện viên độc lập và phòng gym tại Việt Nam.</p>
        </div>
        <nav aria-label="Sản phẩm" className="flex flex-col gap-3 text-[0.95rem]">
          <p className="font-semibold">Sản phẩm</p>
          <Link to="/#cach-hoat-dong" className="text-ps-band-muted hover:text-ps-band-ink">Cách hoạt động</Link>
          <Link to="/huan-luyen-vien" className="text-ps-band-muted hover:text-ps-band-ink">Cho huấn luyện viên</Link>
          <Link to="/phong-gym" className="text-ps-band-muted hover:text-ps-band-ink">Cho phòng gym</Link>
        </nav>
        <nav aria-label="Kiến thức" className="flex flex-col gap-3 text-[0.95rem]">
          <p className="font-semibold">Kiến thức</p>
          <Link to="/kien-thuc" className="text-ps-band-muted hover:text-ps-band-ink">Tất cả bài viết</Link>
          <Link to="/kien-thuc/rpe-la-gi" className="text-ps-band-muted hover:text-ps-band-ink">RPE là gì</Link>
          <Link to="/kien-thuc/doc-phieu-inbody" className="text-ps-band-muted hover:text-ps-band-ink">Đọc phiếu InBody</Link>
        </nav>
        <div className="flex flex-col gap-3 text-[0.95rem]">
          <p className="font-semibold">Thông tin</p>
          <Link to="/dieu-khoan" className="text-ps-band-muted hover:text-ps-band-ink">Điều khoản sử dụng</Link>
          <Link to="/quyen-rieng-tu" className="text-ps-band-muted hover:text-ps-band-ink">Chính sách quyền riêng tư</Link>
          <Link to="/login" className="text-ps-band-muted hover:text-ps-band-ink">Đăng nhập ứng dụng</Link>
        </div>
      </Wrap>
      <Wrap className="overflow-hidden">
        <p aria-hidden="true" className="select-none font-ps-display font-bold leading-[0.8] tracking-[-0.05em] text-ps-band-elev"
          style={{ fontSize: "clamp(5rem, 24vw, 22rem)" }}>
          gymini
        </p>
      </Wrap>
      <Wrap className="flex flex-col gap-2 border-t border-ps-band-line py-6 text-[0.85rem] text-ps-band-muted sm:flex-row sm:justify-between">
        <p>© 2026 Gymini</p>
        <p>Nội dung không thay thế tư vấn của bác sĩ hay chuyên gia dinh dưỡng.</p>
      </Wrap>
    </footer>
  );
}
