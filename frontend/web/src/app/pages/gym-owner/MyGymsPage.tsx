import { useState } from "react";
import { BarbellIcon as Dumbbell, MapPinIcon as MapPin, CircleNotchIcon as Loader2, PlusIcon as Plus, XIcon as X, ClockIcon as Clock, CheckCircleIcon as CheckCircle, XCircleIcon as XCircle, ProhibitIcon as Ban, BuildingsIcon as Building2, CaretDownIcon as ChevronDown, CaretRightIcon as ChevronRight, PencilSimpleIcon as Pencil, CheckIcon as Check, StarIcon as Star } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { Gym, GymBrand, GymStatus } from "../../types";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import { GymLocationFields, type GymLocationValue } from "../../components/gym/GymLocationFields";

const STATUS_CONFIG: Record<GymStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  // GYM_BRANCH_FORM_SPEC.md Phase 1 — never actually rendered through GymCard (drafts get
  // their own section below, filtered out of the normal brand groups), but Record<GymStatus,
  // …> requires an entry for every status value regardless.
  DRAFT:          { label: "Nháp",           color: "text-zinc-400",  bg: "bg-zinc-700/50 border-zinc-700",      icon: Pencil },
  PENDING_REVIEW: { label: "Pending Review", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: Clock },
  APPROVED:       { label: "Approved",       color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", icon: CheckCircle },
  REJECTED:       { label: "Rejected",       color: "text-red-400",   bg: "bg-red-500/10 border-red-500/20",     icon: XCircle },
  SUSPENDED:      { label: "Suspended",      color: "text-zinc-400",  bg: "bg-zinc-700/50 border-zinc-700",      icon: Ban },
};

const WIZARD_TOTAL_STEPS = 7;

/** GYM_BRANCH_FORM_SPEC.md §9/§10 — drafts get their own "Continue Setup" section, never
 * mixed into the real brand-grouped branch cards below (they aren't real branches yet). */
function draftGyms(gyms: Gym[]): Gym[] {
  return gyms.filter((g) => g.status === "DRAFT");
}

/** Gyms that never joined a brand, grouped separately from chains below. */
function standaloneGyms(gyms: Gym[]): Gym[] {
  return gyms.filter((g) => !g.brandId && g.status !== "DRAFT");
}

function branchesForBrand(gyms: Gym[], brandId: string): Gym[] {
  return gyms.filter((g) => g.brandId === brandId && g.status !== "DRAFT");
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
  isOwner,
}: {
  brand: GymBrand;
  branches: Gym[];
  onOpenBranch: (gymId: string) => void;
  onAddBranch: () => void;
  onRename: (brandId: string, newName: string) => void;
  isRenaming: boolean;
  /** GYM_MANAGEMENT master spec §61 — a MANAGER never sees brand-editing or "add branch"
   * controls; OWNER-only actions are hidden here rather than shown-then-403'd. */
  isOwner: boolean;
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
        {isOwner && (editing ? (
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
        ))}
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
          {isOwner && (
            <button
              type="button"
              onClick={onAddBranch}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-700/60 p-4 text-zinc-500 hover:border-green-500/40 hover:text-green-400 transition-[transform,border-color,color] active:scale-[0.98]"
            >
              <Plus className="w-5 h-5" />
              <span className="text-xs font-semibold">Thêm chi nhánh</span>
            </button>
          )}
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
  const [gymForm, setGymForm] = useState({ name: "", address: "", city: "", description: "" });
  const [gymLocation, setGymLocation] = useState<GymLocationValue>({ provinceCode: null, wardCode: null, latitude: null, longitude: null });

  // First-run brand setup — dismissible (X), not a hard block: an owner who closes it and
  // tries "New Gym" anyway just gets createGym's own "set up your brand first" error, so
  // there is no actual way around naming the brand before a gym can exist, this is just not a
  // modal they are trapped behind while looking around.
  const [brandPromptDismissed, setBrandPromptDismissed] = useState(false);
  const [brandForm, setBrandForm] = useState({ name: "", description: "" });

  const { data: gyms = [], isLoading: gymsLoading } = useQuery<Gym[]>({
    queryKey: ["owned-gyms"],
    queryFn: () => gymService.listOwnedGyms(),
  });

  const { data: brands = [], isLoading: brandsLoading } = useQuery<GymBrand[]>({
    queryKey: ["owned-brands"],
    queryFn: () => gymService.listOwnedBrands(),
  });

  // GYM_MANAGEMENT master spec §61 — same cache key AppShell's onboarding gate already
  // populates; a MANAGER never sees brand/create-branch controls here (hidden, not 403'd).
  const { data: onboardingStatus } = useQuery({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const isOwner = onboardingStatus?.role !== "MANAGER";

  const isLoading = gymsLoading || brandsLoading;
  const needsBrandSetup = !isLoading && brands.length === 0;
  useBackDismissible(needsBrandSetup && !brandPromptDismissed, () => setBrandPromptDismissed(true));

  // One owner, one brand — every gym the owner creates joins THEIR brand, decided
  // server-side from ownership alone (see gym.service.ts's createGym). The brand itself is
  // only ever created through the prompt below, once, by the owner naming it themselves —
  // never auto-derived from whatever they happen to call their first branch.
  const createGymMutation = useMutation({
    mutationFn: () =>
      gymService.createGym({
        name: gymForm.name,
        address: gymForm.address,
        city: gymForm.city,
        description: gymForm.description,
        ...gymLocation,
      }),
    onSuccess: () => {
      toast.success(
        brands.length > 0 ? "Đã thêm chi nhánh — chờ admin duyệt" : "Gym created — awaiting admin approval",
      );
      setShowCreateGym(false);
      setGymForm({ name: "", address: "", city: "", description: "" });
      setGymLocation({ provinceCode: null, wardCode: null, latitude: null, longitude: null });
      queryClient.invalidateQueries({ queryKey: ["owned-gyms"] });
      queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to create gym"),
  });

  const createBrandMutation = useMutation({
    mutationFn: () => gymService.createBrand(brandForm),
    onSuccess: () => {
      toast.success("Đã đặt tên thương hiệu — giờ có thể thêm chi nhánh đầu tiên");
      setBrandForm({ name: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể tạo thương hiệu"),
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

  const openAddBranch = () => {
    setGymForm({ name: "", address: "", city: "", description: "" });
    setGymLocation({ provinceCode: null, wardCode: null, latitude: null, longitude: null });
    setShowCreateGym(true);
  };

  const standalone = standaloneGyms(gyms);
  const drafts = draftGyms(gyms);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Dumbbell className="w-5 h-5 text-green-400" /> My Gyms
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Quản lý thương hiệu và các chi nhánh của bạn</p>
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={needsBrandSetup ? () => setBrandPromptDismissed(false) : openAddBranch}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-[transform,background-color] active:scale-[0.98] shadow-lg shadow-green-500/25"
            >
              <Plus className="w-4 h-4" /> New Gym
            </button>
            {/* GYM_BRANCH_FORM_SPEC.md, Phase 1 — new wizard shell, reachable alongside the
                existing dialog above rather than replacing it (steps 1-6 are still
                placeholders — see AddBranchWizardPage.tsx's own doc comment for the cutover
                plan). Not shown to a MANAGER, same §95.2 gate as "New Gym". */}
            {!needsBrandSetup && (
              <button
                type="button"
                onClick={() => navigate("/gym-owner/gyms/wizard")}
                className="flex items-center gap-2 border border-zinc-700 hover:border-zinc-600 text-zinc-300 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                🧪 Thử wizard mới
              </button>
            )}
          </div>
        )}
      </div>

      {/* GYM_BRANCH_FORM_SPEC.md §9 — resumable drafts, never mixed into the real branch
          cards below (draftGyms/branchesForBrand/standaloneGyms already exclude them). */}
      {isOwner && drafts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-300">Đang thiết lập</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {drafts.map((d) => {
              const pct = Math.round((((d.wizardStep ?? 1) - 1) / WIZARD_TOTAL_STEPS) * 100);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => navigate(`/gym-owner/gyms/wizard/${d.id}`)}
                  className="text-left bg-zinc-900 rounded-xl border border-dashed border-zinc-700 p-4 hover:border-green-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Nháp</span>
                    <span className="text-xs text-zinc-500">{pct}% hoàn thành</span>
                  </div>
                  <p className="text-sm font-semibold text-zinc-200 mt-1">{d.name || "Chi nhánh mới"}</p>
                  <div className="h-1 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs font-semibold text-green-400 mt-2">Tiếp tục thiết lập →</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* First-run: nothing else on this page matters until the owner has named their brand —
          every gym they create from here on joins it automatically. */}
      {needsBrandSetup && !brandPromptDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-green-400" /> Đặt tên thương hiệu của bạn
              </h3>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setBrandPromptDismissed(true)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-zinc-500">
                Đây là tên khách sẽ thấy khi tìm kiếm — mọi phòng gym bạn tạo sau này đều là một
                chi nhánh của thương hiệu này. Có thể đổi tên sau nếu cần.
              </p>
              <input
                aria-label="Brand name"
                autoFocus
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
              <button
                type="button"
                onClick={() => setBrandPromptDismissed(true)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Để sau
              </button>
              <button
                type="button"
                onClick={() => createBrandMutation.mutate()}
                disabled={!brandForm.name.trim() || createBrandMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-[background-color,opacity] flex items-center justify-center gap-2"
              >
                {createBrandMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Tiếp tục
              </button>
            </div>
          </div>
        </div>
      )}

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
              isOwner={isOwner}
            />
          ))}
        </div>
      )}

      {/* Legacy display only — a gym could stand outside any brand before this page stopped
          offering that choice. Read-only here on purpose: the "+ New Gym" button above (and
          "+ Thêm chi nhánh" inside a brand group) are the only ways to create a gym now, and
          both always join the owner's one brand — nothing should add another standalone one. */}
      {!isLoading && standalone.length > 0 && (
        <div>
          {brands.length > 0 && (
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-600 mb-2">Phòng gym độc lập</h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {standalone.map((g) => (
              <GymCard key={g.id} gym={g} onClick={() => navigate(`/gym-owner/gyms/${g.id}`)} />
            ))}
          </div>
        </div>
      )}

      {/* Create gym / branch dialog */}
      {showCreateGym && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">{brands.length > 0 ? "Thêm chi nhánh" : "Create Gym"}</h3>
              <button type="button" aria-label="Đóng" onClick={() => setShowCreateGym(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
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
              <div className="pt-2 border-t border-zinc-800/60">
                <GymLocationFields value={gymLocation} onChange={setGymLocation} />
              </div>
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
    </div>
  );
}
