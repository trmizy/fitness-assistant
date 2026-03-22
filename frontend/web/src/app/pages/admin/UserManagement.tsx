import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Shield, UserCheck, UserX, MoreVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adminService } from "../../services/api";

type ManagedUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "ADMIN" | "CUSTOMER" | "PT";
  createdAt: string;
  updatedAt?: string;
};

const roleOptions: Array<Exclude<ManagedUser["role"], "ADMIN">> = ["CUSTOMER", "PT"];

const roleLabelMap: Record<Exclude<ManagedUser["role"], "ADMIN">, string> = {
  CUSTOMER: "Client",
  PT: "PT",
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value?: string) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatRelative(value?: string) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(value);
}

export function UserManagement() {
  const queryClient = useQueryClient();
  const [pendingRoleById, setPendingRoleById] = useState<Record<string, ManagedUser["role"]>>({});
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "CUSTOMER" | "PT">("ALL");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const result = await adminService.listUsers();
      const users = (result?.users || []) as ManagedUser[];
      return users.filter((u) => u.role !== "ADMIN");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async (params: { userId: string; role: ManagedUser["role"] }) => {
      return adminService.updateUserRole(params.userId, params.role);
    },
    onSuccess: () => {
      toast.success("User role updated");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: any) => {
      const fallback = "Failed to update user role";
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.error ||
        error?.message ||
        fallback;
      toast.error(typeof message === "string" ? message : fallback);
    },
  });

  const users = useMemo(() => usersQuery.data || [], [usersQuery.data]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").toLowerCase();
      const textMatch =
        fullName.includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase());
      const roleMatch = roleFilter === "ALL" || u.role === roleFilter;
      return textMatch && roleMatch;
    });
  }, [users, search, roleFilter]);

  const selectedUser = useMemo(
    () => filteredUsers.find((u) => u.id === selectedUserId) || null,
    [filteredUsers, selectedUserId],
  );

  const onRoleSelect = (userId: string, role: ManagedUser["role"]) => {
    setPendingRoleById((prev) => ({ ...prev, [userId]: role }));
  };

  const onSaveRole = (user: ManagedUser) => {
    const nextRole = pendingRoleById[user.id] || user.role;
    if (nextRole === user.role) {
      toast.message("No role change detected");
      return;
    }
    updateRoleMutation.mutate({ userId: user.id, role: nextRole });
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100">User Management</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          {users.length} users · {filteredUsers.length} matched
        </p>
      </div>

      {usersQuery.isLoading ? (
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-8 text-center">
          <Loader2 className="w-10 h-10 text-zinc-600 mx-auto mb-3 animate-spin" />
          <p className="text-zinc-400 text-sm">Loading users...</p>
        </div>
      ) : usersQuery.isError ? (
        <div className="bg-zinc-900 border border-red-500/20 rounded-xl p-8 text-center">
          <UserX className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-zinc-100 font-semibold">Failed to load users</p>
          <p className="text-zinc-500 text-sm mt-1">Please check admin permissions and API status.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 bg-zinc-800/80 border border-zinc-700/50 rounded-xl px-4 py-2.5 flex-1">
              <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users by name or email..."
                className="flex-1 text-sm bg-transparent outline-none text-zinc-300 placeholder-zinc-600"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as "ALL" | "CUSTOMER" | "PT")}
              className="px-3 py-2 border border-zinc-700/50 rounded-xl text-sm bg-zinc-800/80 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
            >
              <option value="ALL">All roles</option>
              <option value="CUSTOMER">Client</option>
              <option value="PT">PT</option>
            </select>
          </div>

          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-600 bg-zinc-800/40 border-b border-zinc-800/60 uppercase tracking-wider">
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Joined</th>
                      <th className="px-4 py-3">Last Updated</th>
                      <th className="px-4 py-3">Change Role</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => {
                      const selectedRole = pendingRoleById[user.id] || user.role;
                      const changed = selectedRole !== user.role;
                      const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown User";

                      return (
                        <tr
                          key={user.id}
                          onClick={() => setSelectedUserId(selectedUserId === user.id ? null : user.id)}
                          className={`border-b border-zinc-800/40 last:border-0 transition-colors cursor-pointer ${
                            selectedUserId === user.id
                              ? "bg-green-500/5 border-l-2 border-l-green-500/40"
                              : "hover:bg-zinc-800/30"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                user.role === "PT"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : "bg-blue-500/20 text-blue-400"
                              }`}>
                                {initials(name)}
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-zinc-200">{name}</div>
                                <div className="text-xs text-zinc-500">{user.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                              user.role === "PT"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                            }`}>
                              {roleLabelMap[user.role as Exclude<ManagedUser["role"], "ADMIN">] || user.role}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-500">{formatDate(user.createdAt)}</td>
                          <td className="px-4 py-3 text-zinc-500">{formatRelative(user.updatedAt)}</td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <select
                              value={selectedRole}
                              onChange={(e) => onRoleSelect(user.id, e.target.value as ManagedUser["role"])}
                              className="bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md px-2 py-1"
                            >
                              {roleOptions.map((role) => (
                                <option key={role} value={role}>
                                  {roleLabelMap[role]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={!changed || updateRoleMutation.isPending}
                              onClick={() => onSaveRole(user)}
                              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-green-500 text-black disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-400"
                            >
                              Save
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-600">
                          No users match current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedUser && (
              <div className="lg:w-72 bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 self-start flex-shrink-0">
                <div className="text-center mb-4 pb-4 border-b border-zinc-800/60">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-3 ${
                    selectedUser.role === "PT"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-blue-500/20 text-blue-400"
                  }`}>
                    {initials([selectedUser.firstName, selectedUser.lastName].filter(Boolean).join(" ") || selectedUser.email)}
                  </div>
                  <h3 className="text-zinc-100 font-bold">
                    {[selectedUser.firstName, selectedUser.lastName].filter(Boolean).join(" ") || "Unknown User"}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">{selectedUser.email}</p>
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border mt-2 bg-green-500/10 text-green-400 border-green-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-current" />
                    Active
                  </span>
                </div>

                <div className="space-y-2.5 text-sm border-b border-zinc-800/60 pb-4 mb-4">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Role</span>
                    <span className="text-zinc-300 font-medium">
                      {roleLabelMap[selectedUser.role as Exclude<ManagedUser["role"], "ADMIN">] || selectedUser.role}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Joined</span>
                    <span className="text-zinc-300 font-medium">{formatDate(selectedUser.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Last Updated</span>
                    <span className="text-zinc-300 font-medium">{formatRelative(selectedUser.updatedAt)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                    <Shield className="w-4 h-4 text-blue-400" /> View profile snapshot
                  </button>
                  <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-green-400 hover:bg-green-500/10 rounded-lg transition-colors">
                    <UserCheck className="w-4 h-4" /> Role managed by admin
                  </button>
                  <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800 rounded-lg transition-colors">
                    <MoreVertical className="w-4 h-4" /> More actions (coming soon)
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
