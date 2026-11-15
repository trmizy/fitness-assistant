import { Navigate, useParams, useSearchParams } from "react-router";
import { useApp } from "../../context/AppContext";
import { ROLE_HOME } from "../../config/landing";

type Tab = "detail" | "pricing" | "reviews";
const TABS: Tab[] = ["detail", "pricing", "reviews"];
export function parseGymTab(raw: string | null): Tab | undefined {
  return TABS.find((t) => t === raw);
}

/**
 * Liên kết chia sẻ của chi tiết một phòng gym: /gyms/:id (nút "Chia sẻ" trong chi tiết gym sao chép đúng đường dẫn này).
 * Không có trang công khai cho khách (quyết định 15/11 5b):
 * - Chưa đăng nhập: chuyển sang /login kèm đường quay lại; đăng nhập xong mở thẳng chi tiết gym đó.
 * - Khách hàng / PT đã đăng nhập: mở chi tiết ngay trên trang tìm phòng gym (/client/gyms?gym=...).
 * - Chủ gym / admin / nhân viên: không có màn khách hàng, về trang chủ của vai trò.
 */
export function PublicGymPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { isAuthenticated, role } = useApp();
  const tab = parseGymTab(params.get("tab"));
  const q = new URLSearchParams({ gym: id });
  if (tab) q.set("tab", tab);
  const detailPath = `/client/gyms?${q.toString()}`;

  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: detailPath }} />;
  if (role === "client" || role === "pt") return <Navigate to={detailPath} replace />;
  return <Navigate to={ROLE_HOME[role]} replace />;
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
