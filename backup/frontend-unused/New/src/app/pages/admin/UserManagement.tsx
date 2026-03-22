import { useState } from "react";
import { Search, Shield, UserCheck, UserX, MoreVertical } from "lucide-react";

const allUsers = [
  { id: 1, name: "Alex Johnson",   email: "alex@example.com",       role: "Client", status: "Active",   joined: "Jan 10, 2025", lastActive: "Today",  sessions: 7,   contracts: 1  },
  { id: 2, name: "Sarah Mitchell", email: "sarah.pt@example.com",   role: "PT",     status: "Active",   joined: "Dec 5, 2024",  lastActive: "Today",  sessions: 342, contracts: 14 },
  { id: 3, name: "Emma Wilson",    email: "emma@example.com",        role: "PT",     status: "Pending",  joined: "Jun 17, 2025", lastActive: "Jun 17", sessions: 0,   contracts: 0  },
  { id: 4, name: "Ryan Park",      email: "ryan@example.com",        role: "Client", status: "Active",   joined: "Feb 1, 2025",  lastActive: "Jun 15", sessions: 5,   contracts: 1  },
  { id: 5, name: "Tom Wallace",    email: "tom@example.com",         role: "Client", status: "Inactive", joined: "Mar 20, 2025", lastActive: "Jun 5",  sessions: 1,   contracts: 1  },
  { id: 6, name: "Maria Chen",     email: "maria@example.com",       role: "Client", status: "Active",   joined: "Apr 12, 2025", lastActive: "Jun 18", sessions: 3,   contracts: 1  },
  { id: 7, name: "James Kwan",     email: "james.pt@example.com",   role: "PT",     status: "Active",   joined: "Nov 15, 2024", lastActive: "Jun 18", sessions: 480, contracts: 18 },
];

const initials = (name: string) => name.split(" ").map(n => n[0]).join("");

export function UserManagement() {
  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedUser, setSelectedUser] = useState<typeof allUsers[0] | null>(null);

  const filtered = allUsers.filter(u =>
    (u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())) &&
    (roleFilter   === "All" || u.role   === roleFilter)   &&
    (statusFilter === "All" || u.status === statusFilter)
  );

  const statusBadge = (status: string) => {
    if (status === "Active")   return "bg-green-500/10 text-green-400 border-green-500/20";
    if (status === "Pending")  return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    return "bg-zinc-700/50 text-zinc-500 border-zinc-700";
  };

  const roleBadge = (role: string) =>
    role === "PT"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : "bg-blue-500/10 text-blue-400 border-blue-500/20";

  const avatarBg = (role: string) =>
    role === "PT" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-zinc-100">User Management</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          {allUsers.length} registered users · {allUsers.filter(u => u.status === "Active").length} active
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-800/80 border border-zinc-700/50 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users…"
            className="flex-1 text-sm bg-transparent outline-none text-zinc-300 placeholder-zinc-600"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-3 py-2 border border-zinc-700/50 rounded-xl text-sm bg-zinc-800/80 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
          >
            <option value="All">All Roles</option>
            <option value="Client">Client</option>
            <option value="PT">PT</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-zinc-700/50 rounded-xl text-sm bg-zinc-800/80 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
          >
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Pending">Pending</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Table */}
        <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="text-left text-xs text-zinc-600 bg-zinc-800/40 border-b border-zinc-800/60 uppercase tracking-wider">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3">Last Active</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
                    className={`border-b border-zinc-800/40 last:border-0 cursor-pointer transition-colors ${
                      selectedUser?.id === u.id
                        ? "bg-green-500/5 border-l-2 border-l-green-500/40"
                        : "hover:bg-zinc-800/30"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${avatarBg(u.role)}`}>
                          {initials(u.name)}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-zinc-200">{u.name}</div>
                          <div className="text-xs text-zinc-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${roleBadge(u.role)}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${statusBadge(u.status)}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-500">{u.joined}</td>
                    <td className="px-4 py-3 text-sm text-zinc-500">{u.lastActive}</td>
                    <td className="px-4 py-3">
                      <button className="p-1 text-zinc-600 hover:text-zinc-300 rounded transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-600">
                      No users match your filters.
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
            <div className="text-center mb-4 pb-4 border-b border-zinc-800/60">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-3 ${avatarBg(selectedUser.role)}`}>
                {initials(selectedUser.name)}
              </div>
              <h3 className="text-zinc-100 font-bold">{selectedUser.name}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{selectedUser.email}</p>
              <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border mt-2 ${statusBadge(selectedUser.status)}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-current" />
                {selectedUser.status}
              </span>
            </div>

            <div className="space-y-2.5 text-sm border-b border-zinc-800/60 pb-4 mb-4">
              {[
                { label: "Role",        value: selectedUser.role        },
                { label: "Joined",      value: selectedUser.joined      },
                { label: "Last Active", value: selectedUser.lastActive  },
                { label: "Sessions",    value: String(selectedUser.sessions)   },
                { label: "Contracts",   value: String(selectedUser.contracts)  },
              ].map(row => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-zinc-500">{row.label}</span>
                  <span className="text-zinc-300 font-medium">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                <Shield className="w-4 h-4 text-blue-400" /> View full profile
              </button>
              {selectedUser.status === "Pending" && (
                <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/15 transition-colors font-semibold">
                  <UserCheck className="w-4 h-4" /> Approve PT
                </button>
              )}
              <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                <UserX className="w-4 h-4" /> Suspend account
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
