import { useState } from "react";
import { Dumbbell, MapPin, Loader2, Plus, X, Clock, CheckCircle, XCircle, Ban, Building2, ChevronDown, ChevronRight, Pencil, Check, Star } from "lucide-react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { Gym, GymBrand, GymStatus } from "../../types";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const STATUS_CONFIG: Record<GymStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING_REVIEW: { label: "Pending Review", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: Clock },
  APPROVED:       { label: "Approved",       color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", icon: CheckCircle },
  REJECTED:       { label: "Rejected",       color: "text-red-400",   bg: "bg-red-500/10 border-red-500/20",     icon: XCircle },
  SUSPENDED:      { label: "Suspended",      color: "text-zinc-400",  bg: "bg-zinc-700/50 border-zinc-700",      icon: Ban },
};

/** Gyms that never joined a brand, grouped separately from chains below. */
function standaloneGyms(gyms: Gym[]): Gym[] {
  return gyms.filter((g) => !g.brandId);
}

function branchesForBrand(gyms: Gym[], brandId: string): Gym[] {
  return gyms.filter((g) => g.brandId === brandId);
}

function GymCard({ gym, onClick }: { gym: Gym; onClick: () => void }) {
  const cfg = STATUS_CONFIG[gym.status];
  // Stats (hội viên/sao) only exist for gyms the public can already see — a PENDING_REVIEW
  // or REJECTED gym has never had a member or review, so the row would just show zeros.
  const showStats = gym.status === "APPROVED" || gym.status === "SUSPENDED";
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 hover:border-green-500/40 transition-colors flex flex-col"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
          <Dumbbell className="w-5 h-5 text-green-400" />
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.bg} ${cfg.color}`}>
          <cfg.icon className="w-3 h-3" /> {cfg.label}
        </span>
      </div>
      <div className="text-sm font-bold text-zinc-200">{gym.name}</div>
      <div className="flex items-center gap-1 text-xs text-zinc-500 mt-1">
        <MapPin className="w-3 h-3" /> {gym.address}{gym.city ? `, ${gym.city}` : ""}
      </div>
      <div className="mt-3 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
        {gym.status === "PENDING_REVIEW" ? (
          <span className="text-xs text-amber-400">Đang chờ admin duyệt...</span>
        ) : showStats ? (
          <>
            <span className="flex items-center gap-3 text-xs text-zinc-500">
              <span>{gym.activeMemberCount ?? 0} hội viên</span>
              <span className="flex items-center gap-1 text-amber-400">
                <Star className="w-3 h-3 fill-amber-400" /> {(gym.averageRating ?? 0).toFixed(1)}
              </span>
            </span>
            <span className="text-xs font-semibold text-green-400 flex items-center gap-0.5 shrink-0">
              Quản lý <ChevronRight className="w-3 h-3" />
            </span>
          </>
        ) : (
          <span className="text-xs text-zinc-600">Đã bị từ chối</span>
        )}
      </div>
    </button>
  );
}

function BrandGroup({
  brand,
  branches,
  onOpenBranch,
  onAddBranch,
  onRename,
  isRenaming,
}: {
  brand: GymBrand;
  branches: Gym[];
  onOpenBranch: (gymId: string) => void;
  onAddBranch: (brandId: string) => void;
  onRename: (brandId: string, newName: string) => void;
  isRenaming: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(brand.approvedName ?? brand.name);
  const displayName = brand.approvedName ?? brand.name;

  return (
    <div className="bg-zinc-900/60 rounded-2xl border border-zinc-800/60 overflow-hidden">
      <div className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-zinc-800/30 transition-colors gap-2">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
          <Building2 className="w-4 h-4 text-green-400 shrink-0" />
          {editing ? (
            <input
              data-testid="brand-rename-input"
              autoFocus
              value={nameInput}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameInput(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-2 py-0.5 text-sm text-zinc-200 min-w-0"
            />
          ) : (
            <span className="text-sm font-bold text-zinc-200 truncate">{displayName}</span>
          )}
          <span className="text-xs text-zinc-600 shrink-0">{branches.length} chi nhánh</span>
        </button>
        {editing ? (
          <button
            type="button"
            data-testid="brand-rename-save-button"
            onClick={(e) => { e.stopPropagation(); onRename(brand.id, nameInput); setEditing(false); }}
            disabled={!nameInput.trim() || isRenaming}
            className="text-green-400 hover:text-green-300 shrink-0"
          >
            <Check className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="brand-rename-toggle"
            onClick={(e) => { e.stopPropagation(); setNameInput(displayName); setEditing(true); }}
            className="text-zinc-600 hover:text-zinc-300 shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
        </button>
      </div>
      {brand.pendingName && (
        <p data-testid="brand-pending-approval-hint" className="px-4 pb-2 text-[11px] text-amber-400">
          Tên mới đang chờ duyệt: <strong>{brand.pendingName}</strong>
        </p>
      )}
      {expanded && (
        <div className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {branches.map((g) => (
            <GymCard key={g.id} gym={g} onClick={() => onOpenBranch(g.id)} />
          ))}
          <button
            type="button"
            onClick={() => onAddBranch(brand.id)}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-700/60 p-4 text-zinc-500 hover:border-green-500/40 hover:text-green-400 transition-[transform,border-color,color] active:scale-[0.98]"
          >
            <Plus className="w-5 h-5" />
            <span className="text-xs font-semibold">Thêm chi nhánh</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function MyGymsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateGym, setShowCreateGym] = useState(false);
  useBackDismissible(!!showCreateGym, () => setShowCreateGym(false));
  const [showCreateBrand, setShowCreateBrand] = useState(false);
  useBackDismissible(!!showCreateBrand, () => setShowCreateBrand(false));
  const [gymForm, setGymForm] = useState({ name: "", address: "", city: "", description: "", brandId: "" });
  const [brandForm, setBrandForm] = useState({ name: "", description: "" });

  const { data: gyms = [], isLoading: gymsLoading } = useQuery<Gym[]>({
    queryKey: ["owned-gyms"],
    queryFn: () => gymService.listOwnedGyms(),
  });

  const { data: brands = [], isLoading: brandsLoading } = useQuery<GymBrand[]>({
    queryKey: ["owned-brands"],
    queryFn: () => gymService.listOwnedBrands(),
  });

  const isLoading = gymsLoading || brandsLoading;

  const createGymMutation = useMutation({
    mutationFn: () =>
      gymService.createGym({
        name: gymForm.name,
        address: gymForm.address,
        city: gymForm.city,
        description: gymForm.description,
        brandId: gymForm.brandId || undefined,
      }),
    onSuccess: () => {
      toast.success(gymForm.brandId ? "Đã thêm chi nhánh — chờ admin duyệt" : "Gym created — awaiting admin approval");
      setShowCreateGym(false);
      setGymForm({ name: "", address: "", city: "", description: "", brandId: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-gyms"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to create gym"),
  });

  const createBrandMutation = useMutation({
    mutationFn: () => gymService.createBrand(brandForm),
    onSuccess: () => {
      toast.success("Đã tạo thương hiệu");
      setShowCreateBrand(false);
      setBrandForm({ name: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to create brand"),
  });

  // Vòng 4 / Phase C1 — a rename only ever moves pendingName; approvedName (what's shown
  // publicly) is untouched until an admin approves it.
  const renameBrandMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => gymService.updateBrand(id, { name }),
    onSuccess: () => {
      toast.success("Đã lưu — tên mới sẽ hiển thị công khai sau khi admin duyệt");
      queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể đổi tên"),
  });

  const openAddBranch = (brandId: string) => {
    setGymForm({ name: "", address: "", city: "", description: "", brandId });
    setShowCreateGym(true);
  };

  const standalone = standaloneGyms(gyms);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Dumbbell className="w-5 h-5 text-green-400" /> My Gyms
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Quản lý thương hiệu, chi nhánh và phòng gym độc lập của bạn</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCreateBrand(true)}
            className="flex items-center gap-2 border border-zinc-700/60 bg-zinc-900 text-zinc-200 px-4 py-2.5 rounded-xl text-sm font-bold transition-[transform,border-color] active:scale-[0.98] hover:border-zinc-600"
          >
            <Building2 className="w-4 h-4" /> Tạo thương hiệu
          </button>
          <button
            type="button"
            onClick={() => {
              setGymForm({ name: "", address: "", city: "", description: "", brandId: "" });
              setShowCreateGym(true);
            }}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-[transform,background-color] active:scale-[0.98] shadow-lg shadow-green-500/25"
          >
            <Plus className="w-4 h-4" /> New Gym
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      )}

      {!isLoading && gyms.length === 0 && brands.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No gyms yet</h3>
          <p className="text-sm text-zinc-500 mb-6">Create your first gym to start selling memberships.</p>
        </div>
      )}

      {!isLoading && brands.length > 0 && (
        <div className="space-y-3">
          {brands.map((brand) => (
            <BrandGroup
              key={brand.id}
              brand={brand}
              branches={branchesForBrand(gyms, brand.id)}
              onOpenBranch={(gymId) => navigate(`/gym-owner/gyms/${gymId}`)}
              onAddBranch={openAddBranch}
              onRename={(id, name) => renameBrandMutation.mutate({ id, name })}
              isRenaming={renameBrandMutation.isPending}
            />
          ))}
        </div>
      )}

      {!isLoading && standalone.length > 0 && (
        <div>
          {brands.length > 0 && (
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-600 mb-2">Phòng gym độc lập</h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {standalone.map((g) => (
              <GymCard key={g.id} gym={g} onClick={() => navigate(`/gym-owner/gyms/${g.id}`)} />
            ))}
            <button
              type="button"
              onClick={() => {
                setGymForm({ name: "", address: "", city: "", description: "", brandId: "" });
                setShowCreateGym(true);
              }}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-700/60 p-4 text-zinc-500 hover:border-green-500/40 hover:text-green-400 transition-[transform,border-color,color] active:scale-[0.98] min-h-[104px]"
            >
              <Plus className="w-5 h-5" />
              <span className="text-xs font-semibold">Thêm phòng gym</span>
            </button>
          </div>
        </div>
      )}

      {/* Create gym / branch dialog */}
      {showCreateGym && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">{gymForm.brandId ? "Thêm chi nhánh" : "Create Gym"}</h3>
              <button type="button" aria-label="Đóng" onClick={() => setShowCreateGym(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {brands.length > 0 && (
                <div>
                  <label className="text-xs text-zinc-500 mb-1.5 block">Thương hiệu (tuỳ chọn)</label>
                  <select
                    aria-label="Thương hiệu"
                    value={gymForm.brandId}
                    onChange={(e) => setGymForm({ ...gymForm, brandId: e.target.value })}
                    className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  >
                    <option value="">Không thuộc thương hiệu nào</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <input
                aria-label="Gym name"
                value={gymForm.name}
                onChange={(e) => setGymForm({ ...gymForm, name: e.target.value })}
                placeholder="Gym name"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Address"
                value={gymForm.address}
                onChange={(e) => setGymForm({ ...gymForm, address: e.target.value })}
                placeholder="Address"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="City"
                value={gymForm.city}
                onChange={(e) => setGymForm({ ...gymForm, city: e.target.value })}
                placeholder="City"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <textarea
                aria-label="Description"
                value={gymForm.description}
                onChange={(e) => setGymForm({ ...gymForm, description: e.target.value })}
                rows={3}
                placeholder="Description (optional)"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button type="button" onClick={() => setShowCreateGym(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createGymMutation.mutate()}
                disabled={!gymForm.name.trim() || !gymForm.address.trim() || createGymMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-[background-color,opacity] flex items-center justify-center gap-2"
              >
                {createGymMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create brand dialog */}
      {showCreateBrand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">Tạo thương hiệu</h3>
              <button type="button" aria-label="Đóng" onClick={() => setShowCreateBrand(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-zinc-500">
                Một thương hiệu gom nhiều chi nhánh cùng tên lại với nhau — khách tìm kiếm sẽ thấy một thẻ duy nhất, bấm vào để chọn chi nhánh gần mình.
              </p>
              <input
                aria-label="Brand name"
                value={brandForm.name}
                onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
                placeholder="Tên thương hiệu"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <textarea
                aria-label="Brand description"
                value={brandForm.description}
                onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })}
                rows={3}
                placeholder="Mô tả (tuỳ chọn)"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button type="button" onClick={() => setShowCreateBrand(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createBrandMutation.mutate()}
                disabled={!brandForm.name.trim() || createBrandMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-[background-color,opacity] flex items-center justify-center gap-2"
              >
                {createBrandMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
