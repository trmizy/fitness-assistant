import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  Search,
  Check,
  X,
  Clock,
  Loader2,
  Shield,
  Briefcase,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { adminService } from "../../services/api";

type UserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "CUSTOMER" | "PT";
  createdAt: string;
  updatedAt?: string;
};

type PTProfileRow = {
  userId: string;
  isPT: boolean;
  experienceLevel?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
  availableEquipment?: string[];
  activityLevel?: string | null;
  goal?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type PTItem = {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "PT";
  status: "approved" | "submitted";
  submitted: string;
  lastUpdated: string;
  experience: string;
  focus: string;
  activity: string;
  goal: string;
  completeness: number;
  flags: string[];
};

function asText(value?: string | null) {
  return value && value.trim() ? value : "N/A";
}

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
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function experienceLabel(value?: string) {
  if (!value) return "Unknown";
  return value.toLowerCase();
}

export function PTManagement() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "submitted">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ptQuery = useQuery({
    queryKey: ["admin-pt-management"],
    queryFn: async () => {
      const [usersRes, ptRes] = await Promise.all([adminService.listUsers(), adminService.listPTProfiles()]);
      const users = (usersRes?.users || []) as UserRow[];
      const ptProfiles = (ptRes?.pts || []) as PTProfileRow[];

      const profileByUserId = new Map(ptProfiles.map((p) => [p.userId, p]));

      const mapped: PTItem[] = users.map((u) => {
        const profile = profileByUserId.get(u.id);
        const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email.split("@")[0];
        const isApproved = u.role === "PT" && !!profile?.isPT;
        const fieldsCount = [profile?.experienceLevel, profile?.activityLevel, profile?.goal, profile?.availableEquipment?.length]
          .filter(Boolean).length;
        const completeness = Math.min(100, Math.round((fieldsCount / 4) * 100));
        const flags: string[] = [];
        if (!profile) flags.push("No PT profile found");
        if (u.role === "PT" && !profile?.isPT) flags.push("Role/PT flag mismatch");
        if (u.role === "CUSTOMER" && profile?.isPT) flags.push("Customer role but profile isPT=true");

        return {
          id: u.id,
          name: fullName,
          email: u.email,
          role: u.role,
          status: isApproved ? "approved" : "submitted",
          submitted: formatDate(u.createdAt),
          lastUpdated: formatDate(profile?.updatedAt || u.updatedAt),
          experience: experienceLabel(profile?.experienceLevel || undefined),
          focus: asText(profile?.availableEquipment?.slice(0, 2).join(", ")),
          activity: asText(profile?.activityLevel),
          goal: asText(profile?.goal),
          completeness,
          flags,
        };
      });

      return mapped;
    },
  });

  const setPTMutation = useMutation({
    mutationFn: async (params: { userId: string; isPT: boolean }) => {
      return adminService.setPTStatus(params.userId, params.isPT);
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.isPT ? "PT approved successfully" : "PT access revoked");
      queryClient.invalidateQueries({ queryKey: ["admin-pt-management"] });
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to update PT status";
      toast.error(typeof message === "string" ? message : "Failed to update PT status");
    },
  });

  const rows = useMemo(() => ptQuery.data || [], [ptQuery.data]);
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const text = `${r.name} ${r.email}`.toLowerCase();
      const searchOk = text.includes(search.toLowerCase());
      const statusOk = statusFilter === "all" || r.status === statusFilter;
      return searchOk && statusOk;
    });
  }, [rows, search, statusFilter]);

  const selected = filtered.find((r) => r.id === selectedId) || null;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100">PT Management</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          {rows.length} trainers/candidates · {rows.filter((r) => r.status === "approved").length} approved
        </p>
      </div>

      {ptQuery.isLoading ? (
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-8 text-center">
          <Loader2 className="w-10 h-10 text-zinc-600 mx-auto mb-3 animate-spin" />
          <p className="text-zinc-400 text-sm">Loading PT management data...</p>
        </div>
      ) : ptQuery.isError ? (
        <div className="bg-zinc-900 border border-red-500/20 rounded-xl p-8 text-center">
          <X className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-zinc-100 font-semibold">Failed to load PT data</p>
          <p className="text-zinc-500 text-sm mt-1">Please check API and admin permissions.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 bg-zinc-800/80 border border-zinc-700/50 rounded-xl px-4 py-2.5 flex-1">
              <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PT by name or email..."
                className="flex-1 text-sm bg-transparent outline-none text-zinc-300 placeholder-zinc-600"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "approved" | "submitted")}
              className="px-3 py-2 border border-zinc-700/50 rounded-xl text-sm bg-zinc-800/80 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
            >
              <option value="all">All status</option>
              <option value="approved">Approved</option>
              <option value="submitted">Submitted</option>
            </select>
          </div>

          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr className="text-left text-xs text-zinc-600 bg-zinc-800/40 border-b border-zinc-800/60 uppercase tracking-wider">
                      <th className="px-4 py-3">PT Candidate</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Experience</th>
                      <th className="px-4 py-3">Submitted</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                        className={`border-b border-zinc-800/40 last:border-0 cursor-pointer transition-colors ${
                          selectedId === r.id
                            ? "bg-green-500/5 border-l-2 border-l-green-500/40"
                            : "hover:bg-zinc-800/30"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                              r.status === "approved"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-blue-500/20 text-blue-400"
                            }`}>
                              {initials(r.name)}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-zinc-200">{r.name}</div>
                              <div className="text-xs text-zinc-500">{r.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                            r.status === "approved"
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}>
                            {r.status === "approved" ? "Approved" : "Submitted"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-400">{r.experience}</td>
                        <td className="px-4 py-3 text-sm text-zinc-500">{r.submitted}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {r.status === "approved" ? (
                            <button
                              onClick={() => setPTMutation.mutate({ userId: r.id, isPT: false })}
                              disabled={setPTMutation.isPending}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-40"
                            >
                              <X className="w-3.5 h-3.5" /> Revoke
                            </button>
                          ) : (
                            <button
                              onClick={() => setPTMutation.mutate({ userId: r.id, isPT: true })}
                              disabled={setPTMutation.isPending}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 disabled:opacity-40"
                            >
                              <Check className="w-3.5 h-3.5" /> Approve
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-600">
                          No PT candidates match current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selected && (
              <div className="lg:w-80 bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 self-start flex-shrink-0 space-y-4">
                <div className="text-center pb-4 border-b border-zinc-800/60">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-3 ${
                    selected.status === "approved"
                      ? "bg-green-500/15 text-green-400"
                      : "bg-blue-500/15 text-blue-400"
                  }`}>
                    {initials(selected.name)}
                  </div>
                  <h3 className="text-zinc-100 font-bold">{selected.name}</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">{selected.email}</p>
                </div>

                <div className="space-y-2.5 text-sm border-b border-zinc-800/60 pb-4">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Current Status</span>
                    <span className={`font-semibold ${selected.status === "approved" ? "text-green-400" : "text-amber-400"}`}>
                      {selected.status === "approved" ? "Approved PT" : "Submitted"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Role</span>
                    <span className="text-zinc-300 font-medium">{selected.role}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Experience</span>
                    <span className="text-zinc-300 font-medium">{selected.experience}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Last Updated</span>
                    <span className="text-zinc-300 font-medium">{selected.lastUpdated}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs text-zinc-500">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-3.5 h-3.5 text-zinc-600" /> Focus: {selected.focus}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-zinc-600" /> Activity: {selected.activity}
                  </div>
                  <div className="flex items-center gap-2">
                    <Award className="w-3.5 h-3.5 text-zinc-600" /> Goal: {selected.goal}
                  </div>
                </div>

                {selected.flags.length > 0 && (
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg p-3">
                    <p className="text-amber-300 text-xs font-semibold mb-1">Flags</p>
                    <ul className="space-y-1">
                      {selected.flags.map((f) => (
                        <li key={f} className="text-xs text-amber-200 flex items-start gap-1">
                          <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2">
                  {selected.status === "approved" ? (
                    <button
                      onClick={() => setPTMutation.mutate({ userId: selected.id, isPT: false })}
                      disabled={setPTMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-semibold rounded-xl hover:bg-red-500/20 disabled:opacity-40"
                    >
                      <X className="w-4 h-4" /> Revoke PT Access
                    </button>
                  ) : (
                    <button
                      onClick={() => setPTMutation.mutate({ userId: selected.id, isPT: true })}
                      disabled={setPTMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-500 text-black text-sm font-bold rounded-xl hover:bg-green-400 disabled:opacity-40"
                    >
                      <Check className="w-4 h-4" /> Approve PT
                    </button>
                  )}

                  <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-800 text-zinc-300 border border-zinc-700/60 text-sm font-semibold rounded-xl hover:bg-zinc-700 transition-colors">
                    <Shield className="w-4 h-4" /> View Profile Snapshot
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
