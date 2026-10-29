import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { MagnifyingGlassIcon as Search, CircleNotchIcon, UserCheckIcon as UserCheck, UserMinusIcon as UserX, DotsThreeVerticalIcon as MoreVertical, ArrowsClockwiseIcon as RefreshCw, ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, UsersIcon } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
// Goes through the shared `api` instance, not a bare axios import: only that instance
// attaches the token, refreshes it on a 401, and queues concurrent callers behind one
// refresh. A hand-rolled axios call with a manually-read token skips all three and dies
// the moment the access token expires.
import { api } from "../../services/api";
import { adminUsersApi, type AssignableRole } from "../../services/adminUsersApi";
import { useApp } from "../../context/AppContext";
import { DataTable, type DataTableColumn } from "../../components/ui/DataTable";
import { PageHeader } from "../../components/ui/PageHeader";
import { PageSkeleton } from "../../components/ui/PageSkeleton";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { toast } from "sonner";
import { adminRoleVi, adminShortDateVi, adminStatusVi } from "../../utils/adminLabels";
import { describeAdminError, errorStateKind, type AdminErrorView } from "./shared/useAdminError";
import { parseIdParam } from "./shared/b9aUrlState";
import { useRestoreFocus, useReturnFocus } from "./shared/b9aReturnFocus";
import { Pill, type PillTone } from "./shared/b9bPill";
import { buildUserParams, paginate, parsePageParam, parseSearchParam, parseUserRole, parseUserStatus } from "./shared/b9bUrlState";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "Client" | "PT" | "Admin" | "Gym Owner";
  status: "Active" | "Inactive" | "Pending";
  joined: string;
  lastActive: string;
  sessions: number;
  contracts: number;
}

const ROLE_LABEL_TO_ENUM: Record<string, string> = {
  Client: "CUSTOMER",
  PT: "PT",
  "Gym Owner": "GYM_OWNER",
  Admin: "ADMIN",
};
const ROLE_OPTIONS: { value: AssignableRole; label: string }[] = [
  { value: "CUSTOMER", label: "Khách hàng" },
  { value: "PT", label: "Huấn luyện viên (PT)" },
  { value: "GYM_OWNER", label: "Chủ phòng gym" },
];

// Vai trò thật trong đối tác gym (GET /admin/partner-accounts/roles) — tài khoản "Gym Owner" ở bảng
// người dùng gồm cả nhân sự (quản lý, lễ tân, kế toán), không chỉ chủ phòng gym.
const PARTNER_ROLE_LABEL: Record<string, string> = {
  OWNER: "Chủ phòng gym",
  MANAGER: "Quản lý chi nhánh",
  RECEPTIONIST: "Lễ tân",
  ACCOUNTANT: "Kế toán",
};

const PAGE_SIZE = 20;

const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const statusTone = (s: string): PillTone => (s === "Active" ? "success" : s === "Pending" ? "pending" : "neutral");
const roleTone = (r: string): PillTone => (r === "PT" ? "success" : r === "Admin" ? "info" : "neutral");
const avatarBg = (role: string) =>
  role === "PT" ? "bg-st-success-bg text-st-success" : role === "Admin" ? "bg-st-info-bg text-st-info" : "bg-st-neutral-bg text-st-neutral";

const selectCls =
  "min-w-0 flex-1 rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30";

/** After a dialog opened from a menu item closes, the menu item is gone: put focus back on the row's "Thao tác" button. */
function useFocusFallback(open: boolean, selector: string | null) {
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open && selector) {
      was.current = open;
      const t = window.setTimeout(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body || !a.isConnected) (document.querySelector(selector) as HTMLElement | null)?.focus();
      }, 320);
      return () => window.clearTimeout(t);
    }
    was.current = open;
  }, [open, selector]);
}

/**
 * Confirmation dialog on the Radix `ui/dialog` (role="alertdialog": focus trap, Esc, Android-Back, safe Huỷ first).
 * Not `ConfirmDialog`: its default button is the design-system emerald-600 on white = 3.76:1 (fails AA); here the
 * primary action uses the admin `st-success` token (same as MoneyActionDialog). The destructive variant is the shared `destructive` Button.
 */
function ActionDialog({
  open, onCancel, title, description, children, confirmLabel, danger, confirmDisabled, onConfirm,
}: { open: boolean; onCancel: () => void; title: string; description?: string; children?: React.ReactNode; confirmLabel: string; danger?: boolean; confirmDisabled?: boolean; onConfirm: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try { await onConfirm(); } finally { setPending(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription className="text-zinc-400">{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>Huỷ</Button>
          <Button
            variant={danger ? "destructive" : "default"}
            className={danger ? undefined : "bg-st-success text-adm-bg hover:bg-st-success hover:opacity-90"}
            disabled={confirmDisabled || pending}
            onClick={run}
          >
            {pending && <CircleNotchIcon className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserDetailDialog({
  user, roleText, isSelf, onClose, onRole, onLock,
}: { user: AdminUser; roleText: string; isSelf: boolean; onClose: () => void; onRole: () => void; onLock: () => void }) {
  const ret = useReturnFocus(`[data-user-actions="${user.id}"]`);
  const rows = [
    { label: "Vai trò", value: roleText },
    { label: "Ngày tham gia", value: adminShortDateVi(user.joined) },
    { label: "Hoạt động gần nhất", value: adminShortDateVi(user.lastActive) },
    { label: "Số buổi", value: String(user.sessions) },
    { label: "Hợp đồng", value: String(user.contracts) },
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="user-detail" onCloseAutoFocus={ret.onCloseAutoFocus}>
        <DialogHeader className="items-center text-center sm:text-center">
          <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold ${avatarBg(user.role)}`} aria-hidden>
            {initials(user.name)}
          </div>
          <DialogTitle>{user.name}</DialogTitle>
          <DialogDescription className="break-all text-zinc-400">{user.email}</DialogDescription>
          <div className="mx-auto"><Pill tone={statusTone(user.status)}>{adminStatusVi(user.status)}</Pill></div>
        </DialogHeader>
        <dl className="space-y-2.5 border-y border-zinc-800/60 py-4 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <dt className="text-zinc-500">{r.label}</dt>
              <dd className="text-right font-medium text-zinc-300">{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={isSelf} onClick={onRole}>
            <UserCheck className="size-4" /> Đổi vai trò
          </Button>
          <Button variant={user.status === "Inactive" ? "outline" : "destructive"} disabled={isSelf} onClick={onLock}>
            <UserX className="size-4" /> {user.status === "Inactive" ? "Mở khóa" : "Khóa tài khoản"}
          </Button>
        </div>
        {isSelf && <p className="text-xs text-zinc-500">Đây là tài khoản của bạn nên không thể đổi vai trò hoặc khóa.</p>}
      </DialogContent>
    </Dialog>
  );
}

export function UserManagement() {
  const [params, setParams] = useSearchParams();
  const selectedId = parseIdParam(params.get("id"));
  const roleFilter = parseUserRole(params.get("role"));
  const statusFilter = parseUserStatus(params.get("status"));
  const search = parseSearchParam(params.get("q"));
  const pageParam = parsePageParam(params.get("page"));

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const { user: me } = useApp();
  const [partnerRoles, setPartnerRoles] = useState<Record<string, string | null>>({});
  const roleText = (u: AdminUser) => (u.role === "Gym Owner" ? PARTNER_ROLE_LABEL[partnerRoles[u.id] ?? "OWNER"] ?? adminRoleVi(u.role) : adminRoleVi(u.role));
  // Khóa dùng để lọc theo vai trò: tài khoản đối tác tách theo vai trò thật (chủ / quản lý / lễ tân / kế toán).
  const roleKey = (u: AdminUser) => (u.role === "Gym Owner" ? (partnerRoles[u.id] ?? "OWNER") : u.role);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [newRole, setNewRole] = useState<AssignableRole>("CUSTOMER");
  const [lockTarget, setLockTarget] = useState<AdminUser | null>(null);
  const isSelf = (u: AdminUser) => !!me && u.id === me.id;
  const [noteDismissed, setNoteDismissed] = useState<string | null>(null);

  useRestoreFocus(!!roleTarget);
  useRestoreFocus(!!lockTarget);
  const lastActor = useRef<string | null>(null);
  useFocusFallback(!!roleTarget, lastActor.current);
  useFocusFallback(!!lockTarget, lastActor.current);

  // The router commits a URL change a render later; two quick events (typing, two selects) must not each start from the
  // same stale snapshot and drop one another's change. `latest` is updated synchronously on every write and re-synced
  // from the URL whenever the URL itself changes (Back/Forward, reload).
  const urlKey = params.toString();
  const syncedKey = useRef(urlKey);
  const latest = useRef({ id: selectedId, role: roleFilter, status: statusFilter, q: search, page: pageParam });
  if (syncedKey.current !== urlKey) {
    syncedKey.current = urlKey;
    latest.current = { id: selectedId, role: roleFilter, status: statusFilter, q: search, page: pageParam };
  }
  const setState = useCallback(
    (next: { id?: string | null; role?: typeof roleFilter; status?: typeof statusFilter; q?: string; page?: number }, opts: { replace?: boolean } = {}) => {
      latest.current = { ...latest.current, ...next };
      setParams(buildUserParams(latest.current), { replace: opts.replace ?? false });
    },
    [setParams],
  );
  const openDetail = (u: AdminUser) => setState({ id: u.id });
  const closeDetail = (replace = false) => setState({ id: null }, { replace });

  const openRoleDialog = (u: AdminUser) => {
    lastActor.current = `[data-user-actions="${u.id}"]`;
    const cur = ROLE_LABEL_TO_ENUM[u.role];
    setNewRole(cur === "ADMIN" ? "CUSTOMER" : (cur as AssignableRole));
    setRoleTarget(u);
  };
  const openLockDialog = (u: AdminUser) => {
    lastActor.current = `[data-user-actions="${u.id}"]`;
    setLockTarget(u);
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/admin/users");
      setUsers(data.data?.users ?? []);
    } catch (err: unknown) {
      setError(describeAdminError(err));
    } finally {
      setLoading(false);
    }
  };

  const confirmRole = async () => {
    if (!roleTarget) return;
    try {
      await adminUsersApi.updateRole(roleTarget.id, newRole);
      toast.success(`Đã đổi vai trò của ${roleTarget.name}`);
      setRoleTarget(null);
      closeDetail(true);
      await fetchUsers();
    } catch (e: any) {
      toast.error(e?.message ?? "Không thể đổi vai trò");
    }
  };

  const confirmLock = async () => {
    if (!lockTarget) return;
    const unlocking = lockTarget.status === "Inactive";
    try {
      await adminUsersApi.setActive(lockTarget.id, unlocking);
      toast.success(unlocking ? `Đã mở khóa ${lockTarget.name}` : `Đã khóa tài khoản ${lockTarget.name}`);
      setLockTarget(null);
      closeDetail(true);
      await fetchUsers();
    } catch (e: any) {
      toast.error(e?.message ?? "Thao tác thất bại");
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Tra vai trò đối tác cho các tài khoản Gym Owner (≤200 id mỗi lần gọi). Lỗi thì giữ nhãn mặc định.
  useEffect(() => {
    const ids = users.filter((u) => u.role === "Gym Owner").map((u) => u.id);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string | null> = {};
      try {
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await api.get("/admin/partner-accounts/roles", { params: { userIds: ids.slice(i, i + 200).join(",") } });
          const rows: Array<{ userId: string; partnerRole: string | null }> = data?.data ?? data ?? [];
          for (const r of Array.isArray(rows) ? rows : []) next[r.userId] = r.partnerRole;
        }
        if (!cancelled) setPartnerRoles(next);
      } catch {
        /* nhãn mặc định */
      }
    })();
    return () => { cancelled = true; };
  }, [users]);

  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          (u.name.toLowerCase().includes(search.toLowerCase()) ||
            u.email.toLowerCase().includes(search.toLowerCase())) &&
          (roleFilter === "All" || roleKey(u) === roleFilter) &&
          (statusFilter === "All" || u.status === statusFilter),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, search, roleFilter, statusFilter, partnerRoles],
  );
  const paged = paginate(filtered, pageParam, PAGE_SIZE);
  const activeCount = users.filter((u) => u.status === "Active").length;
  const selectedUser = selectedId ? users.find((u) => u.id === selectedId) ?? null : null;
  const unknownSelected = !!selectedId && !loading && !error && !selectedUser && noteDismissed !== selectedId;
  const hasFilters = !!search || roleFilter !== "All" || statusFilter !== "All";

  const columns: DataTableColumn<AdminUser>[] = [
    {
      key: "user",
      header: "Người dùng",
      render: (u) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarBg(u.role)}`} aria-hidden>
            {initials(u.name)}
          </div>
          <div className="min-w-0 text-left">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openDetail(u); }}
              className="block max-w-full truncate rounded text-sm font-semibold text-zinc-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
            >
              {u.name}
            </button>
            <div className="truncate text-xs font-normal text-zinc-500">{u.email}</div>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Vai trò", render: (u) => <Pill tone={roleTone(u.role)}>{roleText(u)}</Pill> },
    { key: "status", header: "Trạng thái", render: (u) => <Pill tone={statusTone(u.status)}>{adminStatusVi(u.status)}</Pill> },
    { key: "joined", header: "Ngày tham gia", render: (u) => <span className="text-sm text-zinc-500">{adminShortDateVi(u.joined)}</span> },
    { key: "last", header: "Hoạt động gần nhất", render: (u) => <span className="text-sm text-zinc-500">{adminShortDateVi(u.lastActive)}</span> },
    {
      key: "actions",
      header: "Thao tác",
      render: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Thao tác với ${u.name}`}
              data-user-actions={u.id}
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1.5 text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => openDetail(u)}>Xem hồ sơ</DropdownMenuItem>
            <DropdownMenuItem disabled={isSelf(u)} onSelect={() => openRoleDialog(u)}>Đổi vai trò</DropdownMenuItem>
            <DropdownMenuItem disabled={isSelf(u)} onSelect={() => openLockDialog(u)}>
              {u.status === "Inactive" ? "Mở khóa" : "Khóa tài khoản"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="Người dùng"
        description={!loading && !error ? `${users.length} người dùng đã đăng ký · ${activeCount} đang hoạt động` : undefined}
        actions={
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-4 py-2.5">
          <Search className="h-4 w-4 flex-shrink-0 text-zinc-500" aria-hidden />
          <input
            value={search}
            onChange={(e) => setState({ q: e.target.value, page: 1 }, { replace: true })}
            placeholder="Tìm theo tên hoặc email…"
            aria-label="Tìm người dùng"
            className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-500"
          />
        </label>
        <div className="flex gap-2">
          <select aria-label="Lọc theo vai trò" value={roleFilter} onChange={(e) => setState({ role: parseUserRole(e.target.value), page: 1 }, { replace: true })} className={selectCls}>
            <option value="All">Tất cả vai trò</option>
            <option value="Client">Hội viên</option>
            <option value="PT">Huấn luyện viên (PT)</option>
            <option value="OWNER">Chủ phòng gym</option>
            <option value="MANAGER">Quản lý chi nhánh</option>
            <option value="RECEPTIONIST">Lễ tân</option>
            <option value="ACCOUNTANT">Kế toán</option>
            <option value="Admin">Quản trị viên</option>
          </select>
          <select aria-label="Lọc theo trạng thái" value={statusFilter} onChange={(e) => setState({ status: parseUserStatus(e.target.value), page: 1 }, { replace: true })} className={selectCls}>
            <option value="All">Tất cả trạng thái</option>
            <option value="Active">Đang hoạt động</option>
            <option value="Inactive">Đã khóa</option>
            <option value="Pending">Chờ duyệt</option>
          </select>
        </div>
      </div>

      {unknownSelected && (
        <div role="status" data-testid="user-unknown-id" className="flex items-center justify-between gap-3 rounded-xl border border-st-warning-border bg-st-warning-bg px-4 py-3 text-xs text-st-warning">
          <span>Không tìm thấy người dùng này — có thể đã bị xoá hoặc đường dẫn sai. Đang hiện danh sách.</span>
          <button onClick={() => { setNoteDismissed(selectedId); closeDetail(true); }} className="shrink-0 font-bold underline">Đóng</button>
        </div>
      )}

      {loading && <div role="status" data-testid="users-loading" aria-busy="true" aria-label="Đang tải người dùng"><PageSkeleton variant="list" rows={6} /></div>}

      {!loading && error && (
        <div data-testid="users-load-error">
          <ErrorState kind={errorStateKind(error)} message={error.message} onRetry={error.kind === "forbidden" ? undefined : fetchUsers} />
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-3">
          <DataTable
            columns={columns}
            rows={paged.rows}
            rowKey={(u) => u.id}
            onRowClick={openDetail}
            emptyState={
              <EmptyState
                icon={UsersIcon}
                title={hasFilters ? "Không có người dùng nào khớp bộ lọc" : "Chưa có người dùng nào"}
                description={hasFilters ? "Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm." : undefined}
              />
            }
          />
          {paged.pages > 1 && (
            <nav aria-label="Phân trang" className="flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" disabled={paged.page <= 1} onClick={() => setState({ page: paged.page - 1 })}>
                <ArrowLeft className="size-4" /> Trước
              </Button>
              <span className="text-xs text-zinc-500" data-testid="users-page-info">
                Trang {paged.page} / {paged.pages} · {paged.total} người dùng
              </span>
              <Button variant="outline" size="sm" disabled={paged.page >= paged.pages} onClick={() => setState({ page: paged.page + 1 })}>
                Sau <ArrowRight className="size-4" />
              </Button>
            </nav>
          )}
        </div>
      )}

      {selectedUser && (
        <UserDetailDialog
          user={selectedUser}
          roleText={roleText(selectedUser)}
          isSelf={isSelf(selectedUser)}
          onClose={() => closeDetail()}
          onRole={() => openRoleDialog(selectedUser)}
          onLock={() => openLockDialog(selectedUser)}
        />
      )}

      <ActionDialog
        open={!!roleTarget}
        onCancel={() => setRoleTarget(null)}
        title="Đổi vai trò"
        description={roleTarget ? `Chọn vai trò mới cho ${roleTarget.name} (${roleTarget.email}).` : undefined}
        confirmLabel="Xác nhận"
        danger={false}
        confirmDisabled={!!roleTarget && ROLE_LABEL_TO_ENUM[roleTarget.role] === newRole}
        onConfirm={confirmRole}
      >
        <select
          aria-label="Vai trò mới"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as AssignableRole)}
          className="w-full rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </ActionDialog>

      <ActionDialog
        open={!!lockTarget}
        onCancel={() => setLockTarget(null)}
        title={lockTarget?.status === "Inactive" ? "Mở khóa tài khoản" : "Khóa tài khoản"}
        description={
          lockTarget
            ? lockTarget.status === "Inactive"
              ? `${lockTarget.name} sẽ có thể đăng nhập lại.`
              : `${lockTarget.name} sẽ không thể đăng nhập cho đến khi được mở khóa.`
            : undefined
        }
        confirmLabel={lockTarget?.status === "Inactive" ? "Mở khóa" : "Khóa tài khoản"}
        danger={lockTarget?.status !== "Inactive"}
        onConfirm={confirmLock}
      />
    </div>
  );
}
