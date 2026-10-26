import { useState, useEffect } from "react";
import { MagnifyingGlassIcon as Search, ShieldIcon as Shield, UserCheckIcon as UserCheck, UserMinusIcon as UserX, DotsThreeVerticalIcon as MoreVertical, CircleNotchIcon as Loader2, ArrowsClockwiseIcon as RefreshCw, XIcon as X } from "@phosphor-icons/react";
import { Button } from "../ui/button";
// Goes through the shared `api` instance, not a bare axios import: only that instance
// attaches the token, refreshes it on a 401, and queues concurrent callers behind one
// refresh. A hand-rolled axios call with a manually-read token skips all three and dies
// the moment the access token expires.
import { api } from "../../services/api";
import { adminUsersApi, type AssignableRole } from "../../services/adminUsersApi";
import { useApp } from "../../context/AppContext";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { toast } from "sonner";
import { adminRoleVi, adminShortDateVi, adminStatusVi } from "../../utils/adminLabels";

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

const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const { user: me } = useApp();
  const [partnerRoles, setPartnerRoles] = useState<Record<string, string | null>>({});
  const roleText = (u: AdminUser) => (u.role === "Gym Owner" ? PARTNER_ROLE_LABEL[partnerRoles[u.id] ?? "OWNER"] ?? adminRoleVi(u.role) : adminRoleVi(u.role));
  // Khóa dùng để lọc theo vai trò: tài khoản đối tác tách theo vai trò thật (chủ / quản lý / lễ tân / kế toán).
  const roleKey = (u: AdminUser) => (u.role === "Gym Owner" ? (partnerRoles[u.id] ?? "OWNER") : u.role);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [newRole, setNewRole] = useState<AssignableRole>("CUSTOMER");
  const [lockTarget, setLockTarget] = useState<AdminUser | null>(null);
  const isSelf = (u: AdminUser) => !!me && u.id === me.id;

  const openRoleDialog = (u: AdminUser) => {
    const cur = ROLE_LABEL_TO_ENUM[u.role];
    setNewRole(cur === "ADMIN" ? "CUSTOMER" : (cur as AssignableRole));
    setRoleTarget(u);
  };

  const confirmRole = async () => {
    if (!roleTarget) return;
    try {
      await adminUsersApi.updateRole(roleTarget.id, newRole);
      toast.success(`Đã đổi vai trò của ${roleTarget.name}`);
      setRoleTarget(null);
      setSelectedUser(null);
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
      setSelectedUser(null);
      await fetchUsers();
    } catch (e: any) {
      toast.error(e?.message ?? "Thao tác thất bại");
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/admin/users");
      setUsers(data.data?.users ?? []);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Không tải được danh sách người dùng");
    } finally {
      setLoading(false);
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

  const filtered = users.filter(
    (u) =>
      (u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())) &&
      (roleFilter === "All" || roleKey(u) === roleFilter) &&
      (statusFilter === "All" || u.status === statusFilter),
  );

  const statusBadge = (status: string) => {
    if (status === "Active")
      return "bg-green-500/10 text-green-400 border-green-500/20";
    if (status === "Pending")
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    return "bg-zinc-700/50 text-zinc-500 border-zinc-700";
  };

  const roleBadge = (role: string) =>
    role === "PT"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : role === "Admin"
        ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
        : "bg-blue-500/10 text-blue-400 border-blue-500/20";

  const avatarBg = (role: string) =>
    role === "PT"
      ? "bg-emerald-500/20 text-emerald-400"
      : role === "Admin"
        ? "bg-purple-500/20 text-purple-400"
        : "bg-blue-500/20 text-blue-400";

  const activeCount = users.filter((u) => u.status === "Active").length;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100">Quản lý người dùng</h1>
          {!loading && !error && (
            <p className="text-zinc-500 text-sm mt-0.5">
              {users.length} người dùng đã đăng ký · {activeCount} đang hoạt động
            </p>
          )}
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 border border-zinc-700/50 rounded-lg hover:bg-zinc-800/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Làm mới
        </button>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-800/80 border border-zinc-700/50 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm người dùng…"
            className="flex-1 text-sm bg-transparent outline-none text-zinc-300 placeholder-zinc-600"
          />
        </div>
        <div className="flex gap-2 [&>select]:min-w-0 [&>select]:flex-1">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 border border-zinc-700/50 rounded-xl text-sm bg-zinc-800/80 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
          >
            <option value="All">Tất cả vai trò</option>
            <option value="Client">Hội viên</option>
            <option value="PT">Huấn luyện viên (PT)</option>
            <option value="OWNER">Chủ phòng gym</option>
            <option value="MANAGER">Quản lý chi nhánh</option>
            <option value="RECEPTIONIST">Lễ tân</option>
            <option value="ACCOUNTANT">Kế toán</option>
            <option value="Admin">Quản trị viên</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-zinc-700/50 rounded-xl text-sm bg-zinc-800/80 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
          >
            <option value="All">Tất cả trạng thái</option>
            <option value="Active">Đang hoạt động</option>
            <option value="Inactive">Đã khóa</option>
            <option value="Pending">Chờ duyệt</option>
          </select>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
          <p className="text-zinc-500 text-sm">Đang tải người dùng…</p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-6 text-center">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button
            onClick={fetchUsers}
            className="text-xs px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Table */}
          <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="text-left text-xs text-zinc-600 bg-zinc-800/40 border-b border-zinc-800/60 uppercase tracking-wider">
                    <th className="px-4 py-3">Người dùng</th>
                    <th className="px-4 py-3">Vai trò</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3">Ngày tham gia</th>
                    <th className="px-4 py-3">Hoạt động gần nhất</th>
                    <th className="px-4 py-3">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() =>
                        setSelectedUser(selectedUser?.id === u.id ? null : u)
                      }
                      className={`border-b border-zinc-800/40 last:border-0 cursor-pointer transition-colors ${
                        selectedUser?.id === u.id
                          ? "bg-green-500/5 border-l-2 border-l-green-500/40"
                          : "hover:bg-zinc-800/30"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${avatarBg(u.role)}`}
                          >
                            {initials(u.name)}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-zinc-200">
                              {u.name}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${roleBadge(u.role)}`}
                        >
                          {roleText(u)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${statusBadge(u.status)}`}
                        >
                          {adminStatusVi(u.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-500">
                        {adminShortDateVi(u.joined)}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-500">
                        {adminShortDateVi(u.lastActive)}
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              aria-label="Thao tác"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 text-zinc-600 hover:text-zinc-300 rounded transition-colors"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onSelect={() => setSelectedUser(u)}>
                              Xem hồ sơ
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={isSelf(u)} onSelect={() => openRoleDialog(u)}>
                              Đổi vai trò
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={isSelf(u)} onSelect={() => setLockTarget(u)}>
                              {u.status === "Inactive" ? "Mở khóa" : "Khóa tài khoản"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-zinc-600"
                      >
                        Không có người dùng nào khớp bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail panel */}
          {selectedUser && (
            <div className="lg:w-72 bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 self-start flex-shrink-0">
              <div className="text-center mb-4 pb-4 border-b border-zinc-800/60 relative">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="absolute top-0 right-0 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  aria-label="Đóng"
                >
                  <X className="w-4 h-4" />
                </button>
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-3 ${avatarBg(selectedUser.role)}`}
                >
                  {initials(selectedUser.name)}
                </div>
                <h3 className="text-zinc-100 font-bold">{selectedUser.name}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {selectedUser.email}
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border mt-2 ${statusBadge(selectedUser.status)}`}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {adminStatusVi(selectedUser.status)}
                </span>
              </div>

              <div className="space-y-2.5 text-sm border-b border-zinc-800/60 pb-4 mb-4">
                {[
                  { label: "Vai trò", value: roleText(selectedUser) },
                  { label: "Ngày tham gia", value: adminShortDateVi(selectedUser.joined) },
                  { label: "Hoạt động gần nhất", value: adminShortDateVi(selectedUser.lastActive) },
                  { label: "Số buổi", value: String(selectedUser.sessions) },
                  { label: "Hợp đồng", value: String(selectedUser.contracts) },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between">
                    <span className="text-zinc-500">{row.label}</span>
                    <span className="text-zinc-300 font-medium">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                  <Shield className="w-4 h-4 text-blue-400" /> Xem hồ sơ đầy đủ
                </button>
                {selectedUser.status === "Pending" && (
                  <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/15 transition-colors font-semibold">
                    <UserCheck className="w-4 h-4" /> Duyệt PT
                  </button>
                )}
                <button
                  disabled={isSelf(selectedUser)}
                  onClick={() => openRoleDialog(selectedUser)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <UserCheck className="w-4 h-4 text-blue-400" /> Đổi vai trò
                </button>
                <button
                  disabled={isSelf(selectedUser)}
                  onClick={() => setLockTarget(selectedUser)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <UserX className="w-4 h-4" />{" "}
                  {selectedUser.status === "Inactive" ? "Mở khóa" : "Khóa tài khoản"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!roleTarget}
        onOpenChange={(o) => !o && setRoleTarget(null)}
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
          className="w-full px-3 py-2 border border-zinc-700/50 rounded-xl text-sm bg-zinc-800/80 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!lockTarget}
        onOpenChange={(o) => !o && setLockTarget(null)}
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
