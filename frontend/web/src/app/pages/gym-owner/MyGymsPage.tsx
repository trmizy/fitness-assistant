import { useState } from "react";
import { Dumbbell, MapPin, Loader2, Plus, X, Clock, CheckCircle, XCircle, Ban } from "lucide-react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { Gym, GymStatus } from "../../types";

const STATUS_CONFIG: Record<GymStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING_REVIEW: { label: "Pending Review", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: Clock },
  APPROVED:       { label: "Approved",       color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", icon: CheckCircle },
  REJECTED:       { label: "Rejected",       color: "text-red-400",   bg: "bg-red-500/10 border-red-500/20",     icon: XCircle },
  SUSPENDED:      { label: "Suspended",      color: "text-zinc-400",  bg: "bg-zinc-700/50 border-zinc-700",      icon: Ban },
};

export function MyGymsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", city: "", description: "" });

  const { data: gyms = [], isLoading } = useQuery<Gym[]>({
    queryKey: ["owned-gyms"],
    queryFn: () => gymService.listOwnedGyms(),
  });

  const createMutation = useMutation({
    mutationFn: () => gymService.createGym(form),
    onSuccess: () => {
      toast.success("Gym created — awaiting admin approval");
      setShowCreate(false);
      setForm({ name: "", address: "", city: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-gyms"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to create gym"),
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Dumbbell className="w-5 h-5 text-green-400" /> My Gyms
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Manage your gym locations, plans, and members</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/25"
        >
          <Plus className="w-4 h-4" /> New Gym
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      )}

      {!isLoading && gyms.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No gyms yet</h3>
          <p className="text-sm text-zinc-500 mb-6">Create your first gym to start selling memberships.</p>
        </div>
      )}

      {!isLoading && gyms.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {gyms.map((g) => {
            const cfg = STATUS_CONFIG[g.status];
            return (
              <button
                type="button"
                key={g.id}
                onClick={() => navigate(`/gym-owner/gyms/${g.id}`)}
                className="text-left bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 hover:border-green-500/40 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                    <Dumbbell className="w-5 h-5 text-green-400" />
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.bg} ${cfg.color}`}>
                    <cfg.icon className="w-3 h-3" /> {cfg.label}
                  </span>
                </div>
                <div className="text-sm font-bold text-zinc-200">{g.name}</div>
                <div className="flex items-center gap-1 text-xs text-zinc-500 mt-1">
                  <MapPin className="w-3 h-3" /> {g.address}{g.city ? `, ${g.city}` : ""}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">Create Gym</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                aria-label="Gym name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Gym name"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Address"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="City"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <textarea
                aria-label="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="Description (optional)"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={!form.name.trim() || !form.address.trim() || createMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
