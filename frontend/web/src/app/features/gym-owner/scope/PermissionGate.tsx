/**
 * The permission / scope states of 05 section 7 as UI.
 *  - PermissionGate: action-level. Never falls back to OWNER while the role is unknown; hides (or shows a disabled
 *    fallback with the reason) when the role may not act. Hiding never replaces the backend check.
 *  - ScopeStateFrame: page-level frame for loading / forbidden / out-of-scope / suspended / error / no-branch.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useApp } from "../../../context/AppContext";
import { permissionState } from "./scopeModel";
import { useGymOwnerScope } from "./GymOwnerScopeProvider";
import type { PartnerRole } from "../../../utils/gymStaffRole";
import { homePathFor } from "../../../utils/gymStaffRole";

export function PermissionGate({
  allow,
  children,
  fallback = null,
  blockWhileScopeChanging = false,
}: {
  allow: readonly PartnerRole[];
  children: ReactNode;
  /** Rendered when the role may never do this but the information helps (e.g. a disabled button + reason). */
  fallback?: ReactNode;
  /** Write actions: also hidden while the scope is switching (05 section 6.10). */
  blockWhileScopeChanging?: boolean;
}) {
  const { role, status, scopeChanging } = useGymOwnerScope();
  const state = permissionState(role, status === "loading", allow);
  if (state === "loading") return null;
  if (state === "forbidden") return <>{fallback}</>;
  if (blockWhileScopeChanging && scopeChanging) return <>{fallback}</>;
  return <>{children}</>;
}

export function ScopeSkeleton() {
  return (
    <div className="go-skel-wrap" data-testid="go-skeleton" aria-hidden="true">
      <div className="go-skel-bar" data-size="lg" />
      <div className="go-skel-bar" style={{ width: "70%" }} />
      <div className="go-skel-bar" data-size="block" />
      <div className="go-skel-bar" data-size="block" />
      <div className="go-skel-bar" style={{ width: "55%" }} />
    </div>
  );
}

export type ScopeStateKind = "loading" | "forbidden" | "out-of-scope" | "suspended" | "error" | "no-branch";

export function ScopeStateFrame({ kind, onRetry }: { kind: ScopeStateKind; onRetry?: () => void }) {
  const navigate = useNavigate();
  const { logout } = useApp();
  const { role, setGymId } = useGymOwnerScope();

  if (kind === "loading") {
    return (
      <div role="status" aria-live="polite" aria-label="Đang tải phạm vi" data-testid="go-state-loading">
        <ScopeSkeleton />
      </div>
    );
  }

  const content: Record<Exclude<ScopeStateKind, "loading">, { title: string; body: string; actions: ReactNode }> = {
    forbidden: {
      title: "Bạn không có quyền xem màn này",
      body: "Vai trò hiện tại của tài khoản chưa được cấp quyền cho nội dung này. Chủ phòng tập là người cấp hoặc đổi quyền nhân sự.",
      actions: (
        <button type="button" className="go-btn" data-variant="primary" onClick={() => navigate(homePathFor(role))}>
          Về trang chủ của tôi
        </button>
      ),
    },
    "out-of-scope": {
      title: "Chi nhánh này không thuộc phạm vi của bạn",
      body: "Liên kết trỏ tới một chi nhánh mà tài khoản này không được giao. Gymini không tự chuyển bạn sang chi nhánh khác.",
      actions: (
        <button type="button" className="go-btn" data-variant="primary" onClick={() => setGymId("ALL")}>
          Về chi nhánh của tôi
        </button>
      ),
    },
    suspended: {
      title: "Đối tác đang bị đình chỉ",
      body: "Quyền vận hành của đối tác tạm thời bị khoá. Vui lòng liên hệ bộ phận hỗ trợ Gymini để biết lý do và cách mở lại.",
      actions: (
        <>
          <button type="button" className="go-btn" onClick={() => void logout()}>
            Đăng xuất
          </button>
          {onRetry && (
            <button type="button" className="go-btn" data-variant="primary" onClick={onRetry}>
              Kiểm tra lại
            </button>
          )}
        </>
      ),
    },
    error: {
      title: "Không tải được dữ liệu phạm vi",
      body: "Đã có lỗi khi xác định vai trò hoặc danh sách chi nhánh. Phạm vi bạn đã chọn được giữ nguyên.",
      actions: onRetry ? (
        <button type="button" className="go-btn" data-variant="primary" onClick={onRetry}>
          Thử lại
        </button>
      ) : null,
    },
    "no-branch": {
      title: "Chưa có chi nhánh trong phạm vi",
      body: "Tài khoản này chưa có chi nhánh nào để làm việc. Chủ phòng tập cần tạo chi nhánh hoặc giao chi nhánh cho bạn.",
      actions: null,
    },
  };
  const c = content[kind];
  return (
    <div className="go-state" role="alert" data-testid={`go-state-${kind}`}>
      <h2>{c.title}</h2>
      <p>{c.body}</p>
      {c.actions && <div className="go-state-actions">{c.actions}</div>}
    </div>
  );
}
