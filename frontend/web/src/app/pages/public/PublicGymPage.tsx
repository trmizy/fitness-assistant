import { Navigate, useNavigate, useParams, useSearchParams, Link } from "react-router";
import { useApp } from "../../context/AppContext";
import { GymDetailModal } from "../../components/gym/GymDetailModal";
import { AppLogo } from "../../components/brand/AppLogo";
import { ROLE_HOME } from "../../config/landing";

type Tab = "detail" | "pricing" | "reviews";
const TABS: Tab[] = ["detail", "pricing", "reviews"];
export function parseGymTab(raw: string | null): Tab | undefined {
  return TABS.find((t) => t === raw);
}

/**
 * Liên kết công khai của chi tiết một phòng gym: /gyms/:id (Q8 / N14G-04) — chính là đường dẫn mà
 * nút "Chia sẻ" trong chi tiết gym sao chép. Dữ liệu lấy từ GET /gyms/:id (route công khai của
 * gym-service, chỉ trả chi nhánh đã duyệt/đang hiển thị, không có dữ liệu riêng tư).
 *
 * - Khách vãng lai: xem được chi tiết; mua gói/đánh giá thì mời đăng nhập rồi quay lại đúng trang này.
 * - Khách hàng / PT đã đăng nhập: mở cùng chi tiết đó ngay trên trang tìm phòng gym (/client/gyms?gym=…).
 * - Chủ gym / admin: xem như khách, không có nút mua.
 */
export function PublicGymPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, role } = useApp();
  const tab = parseGymTab(params.get("tab"));

  if (isAuthenticated && (role === "client" || role === "pt")) {
    const q = new URLSearchParams({ gym: id });
    if (tab) q.set("tab", tab);
    return <Navigate to={`/client/gyms?${q.toString()}`} replace />;
  }

  const leave = () => navigate(isAuthenticated ? ROLE_HOME[role] : "/login", { replace: true });

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 p-4">
        <AppLogo imgClassName="h-8 w-auto" />
        {!isAuthenticated && (
          <nav className="flex items-center gap-2">
            <Link to="/login" className="inline-flex h-10 items-center rounded-lg border border-zinc-700 px-3.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">
              Đăng nhập
            </Link>
            <Link to="/register" className="inline-flex h-10 items-center rounded-lg bg-green-500 px-3.5 text-sm font-bold text-black hover:bg-green-400">
              Đăng ký
            </Link>
          </nav>
        )}
      </header>
      <GymDetailModal gymId={id} initialTab={tab} onClose={leave} />
    </div>
  );
}

/** /client/gyms/:id (liên kết/bookmark cũ, hoặc dán tay) → mở chi tiết ngay trên trang tìm phòng gym. */
export function ClientGymDeepLink() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const q = new URLSearchParams({ gym: id });
  const tab = parseGymTab(params.get("tab"));
  if (tab) q.set("tab", tab);
  return <Navigate to={`/client/gyms?${q.toString()}`} replace />;
}
