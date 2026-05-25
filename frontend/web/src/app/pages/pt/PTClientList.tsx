import { useState } from "react";
import { useNavigate } from "react-router";
import { Search, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { contractService } from "../../services/api";

type Filter = "All" | "Active" | "Expiring" | "Pending";

const filterLabels: Record<Filter, string> = {
  All: "Tất cả",
  Active: "Đang hoạt động",
  Expiring: "Sắp hết hạn",
  Pending: "Chờ duyệt",
};

function getInitials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

function isExpiringSoon(endDate: string | null | undefined) {
  if (!endDate) return false;
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return new Date(endDate) <= in7;
}

export function PTClientList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("All");

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["pt-contracts"],
    queryFn: () => contractService.getByPT(),
  });

  // Deduplicate: one row per client, using their most recent ACTIVE contract (or any contract)
  const clientMap = new Map<string, any>();
  for (const c of contracts) {
    const existing = clientMap.get(c.clientUserId);
    if (!existing) {
      clientMap.set(c.clientUserId, c);
    } else if (c.status === "ACTIVE" && existing.status !== "ACTIVE") {
      clientMap.set(c.clientUserId, c);
    } else if (
      c.status === existing.status &&
      new Date(c.createdAt) > new Date(existing.createdAt)
    ) {
      clientMap.set(c.clientUserId, c);
    }
  }
  const clients = Array.from(clientMap.values());

  const filtered = clients.filter(c => {
    const matchSearch = !search || (c.clientName ?? "").toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filter === "Active")   return c.status === "ACTIVE" && !isExpiringSoon(c.endDate);
    if (filter === "Expiring") return c.status === "ACTIVE" && isExpiringSoon(c.endDate);
    if (filter === "Pending")  return c.status === "PENDING_REVIEW";
    return true;
  });

  function statusBadge(c: any) {
    if (c.status === "ACTIVE" && isExpiringSoon(c.endDate))
      return <span className="text-xs px-2 py-0.5 rounded-full font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/20">Sắp hết hạn</span>;
    if (c.status === "ACTIVE")
      return <span className="text-xs px-2 py-0.5 rounded-full font-semibold border bg-green-500/10 text-green-400 border-green-500/20">Đang hoạt động</span>;
    if (c.status === "PENDING_REVIEW")
      return <span className="text-xs px-2 py-0.5 rounded-full font-semibold border bg-blue-500/10 text-blue-400 border-blue-500/20">Chờ duyệt</span>;
    if (c.status === "COMPLETED")
      return <span className="text-xs px-2 py-0.5 rounded-full font-semibold border bg-zinc-700/60 text-zinc-400 border-zinc-600/40">Hoàn thành</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full font-semibold border bg-zinc-800 text-zinc-500 border-zinc-700/60">{c.status}</span>;
  }

  function formatExpiry(endDate: string | null | undefined) {
    if (!endDate) return "–";
    return new Date(endDate).toLocaleDateString("vi-VN", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100">Học viên của tôi</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          {isLoading ? "Đang tải…" : `${clients.length} quan hệ huấn luyện`}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm học viên…"
            className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {(["All", "Active", "Expiring", "Pending"] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                filter === f
                  ? "bg-green-500 text-black shadow-lg shadow-green-500/20"
                  : "bg-zinc-900 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-12 text-center text-zinc-500 text-sm">
          {search || filter !== "All" ? "Không tìm thấy học viên phù hợp." : "Chưa có học viên nào."}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 border-b border-zinc-800/60 uppercase tracking-wider">
                  <th className="px-4 py-3">Học viên</th>
                  <th className="px-4 py-3">Gói dịch vụ</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Buổi tập</th>
                  <th className="px-4 py-3">Hết hạn</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr
                    key={c.clientUserId}
                    className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/pt/clients/${c.clientUserId}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">
                          {getInitials(c.clientName)}
                        </div>
                        <span className="text-sm font-semibold text-zinc-200">{c.clientName ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{c.packageName ?? "—"}</td>
                    <td className="px-4 py-3">{statusBadge(c)}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{c.usedSessions} / {c.totalSessions}</td>
                    <td className="px-4 py-3 text-sm text-zinc-500">{formatExpiry(c.endDate)}</td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-4 h-4 text-zinc-600" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(c => (
              <button
                key={c.clientUserId}
                onClick={() => navigate(`/pt/clients/${c.clientUserId}`)}
                className="w-full bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 text-left hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center font-bold text-green-400">
                    {getInitials(c.clientName)}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-200">{c.clientName ?? "—"}</div>
                    <div className="text-xs text-zinc-500">{c.packageName ?? "—"}</div>
                  </div>
                  <div className="ml-auto">{statusBadge(c)}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><div className="text-zinc-600">Buổi tập</div><div className="text-zinc-300 font-semibold">{c.usedSessions} / {c.totalSessions}</div></div>
                  <div><div className="text-zinc-600">Hết hạn</div><div className="text-zinc-300 font-semibold">{formatExpiry(c.endDate)}</div></div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
