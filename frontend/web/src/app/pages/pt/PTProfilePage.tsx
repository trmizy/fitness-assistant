import { useState } from "react";
import { useNavigate } from "react-router";
import { MedalIcon as Award, PencilSimpleIcon as Edit3, CheckIcon as Check, PlusIcon as Plus, StarIcon as Star, MapPinIcon as MapPin, PencilSimpleIcon as Pencil, TrashIcon as Trash2, XIcon as X, CircleNotchIcon as Loader2, CopyIcon as Copy, GiftIcon as Gift } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatVND } from "../../utils/currency";
import {
  trainingLocationService,
  locationService,
  ptServicePackageService,
  availabilityService,
  profileService,
  gymService,
  type PTServicePackage,
} from "../../services/api";
import { CollaborationPanel } from "../../components/gym/CollaborationPanel";
import type { Gym } from "../../types";

type TrainingLoc = {
  id: string;
  provinceCode: number;
  wardCode?: number;
  gymName?: string;
  addressLine?: string;
  legacyDistrictName?: string;
  isPrimary: boolean;
  isActive: boolean;
  note?: string;
  province: { name: string };
  ward?: { name: string };
};

const emptyLocForm = {
  provinceCode: "",
  wardCode: "",
  gymName: "",
  addressLine: "",
  isPrimary: false,
  note: "",
};

const emptyPkgForm = {
  name: "",
  description: "",
  sessionCount: "",
  price: "",
  sessionMode: "ONLINE" as "ONLINE" | "OFFLINE",
  sessionDurationMinutes: "60",
  validityDays: "",
};

const DAY_LABELS: Record<string, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};
const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export function PTProfilePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [verificationStatus] = useState<"pending" | "approved">("approved");

  // Training location management
  const [locFormOpen, setLocFormOpen] = useState(false);
  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [locForm, setLocForm] = useState({ ...emptyLocForm });
  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>(
    [],
  );
  const [locWards, setLocWards] = useState<{ code: number; name: string }[]>(
    [],
  );

  const { data: locations = [], isLoading: locsLoading } = useQuery({
    queryKey: ["pt-training-locations"],
    queryFn: trainingLocationService.getMyLocations,
  });

  const createMutation = useMutation({
    mutationFn: trainingLocationService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pt-training-locations"] });
      setLocFormOpen(false);
      setLocForm({ ...emptyLocForm });
      setLocWards([]);
      toast.success("Đã thêm địa điểm");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Lỗi thêm địa điểm"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      trainingLocationService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pt-training-locations"] });
      setEditingLocId(null);
      setLocFormOpen(false);
      setLocForm({ ...emptyLocForm });
      setLocWards([]);
      toast.success("Đã cập nhật địa điểm");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Lỗi cập nhật địa điểm"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trainingLocationService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pt-training-locations"] });
      toast.success("Đã ẩn địa điểm");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Lỗi xóa địa điểm"),
  });

  const openAddForm = async () => {
    setEditingLocId(null);
    setLocForm({ ...emptyLocForm });
    setLocWards([]);
    if (!provinces.length) {
      const ps = await locationService.getProvinces().catch(() => []);
      setProvinces(ps);
    }
    setLocFormOpen(true);
  };

  const openEditForm = async (loc: TrainingLoc) => {
    setEditingLocId(loc.id);
    setLocForm({
      provinceCode: String(loc.provinceCode),
      wardCode: String(loc.wardCode ?? ""),
      gymName: loc.gymName ?? "",
      addressLine: loc.addressLine ?? "",
      isPrimary: loc.isPrimary,
      note: loc.note ?? "",
    });
    if (!provinces.length) {
      const ps = await locationService.getProvinces().catch(() => []);
      setProvinces(ps);
    }
    if (loc.provinceCode) {
      const ws = await locationService
        .getWards(loc.provinceCode)
        .catch(() => []);
      setLocWards(ws);
    }
    setLocFormOpen(true);
  };

  const handleLocProvinceChange = async (code: string) => {
    setLocForm((prev) => ({ ...prev, provinceCode: code, wardCode: "" }));
    setLocWards(
      code ? await locationService.getWards(Number(code)).catch(() => []) : [],
    );
  };

  const submitLocForm = () => {
    if (!locForm.provinceCode) {
      toast.error("Chọn tỉnh/thành");
      return;
    }
    const payload = {
      provinceCode: Number(locForm.provinceCode),
      wardCode: locForm.wardCode ? Number(locForm.wardCode) : undefined,
      gymName: locForm.gymName.trim() || undefined,
      addressLine: locForm.addressLine.trim() || undefined,
      isPrimary: locForm.isPrimary,
      note: locForm.note.trim() || undefined,
    };
    if (editingLocId)
      updateMutation.mutate({ id: editingLocId, data: payload });
    else createMutation.mutate(payload);
  };

  // Service package management
  const [pkgFormOpen, setPkgFormOpen] = useState(false);
  const [editingPkgId, setEditingPkgId] = useState<string | null>(null);
  const [pkgForm, setPkgForm] = useState({ ...emptyPkgForm });

  const { data: pkgData, isLoading: pkgsLoading } = useQuery({
    queryKey: ["pt-service-packages"],
    queryFn: ptServicePackageService.getMyPackages,
  });
  const packages: PTServicePackage[] = pkgData?.packages ?? [];

  // Assigned automatically when a PT is approved (assignReferralCodeIfMissing) — already
  // returned by GET /profile/me, just never rendered anywhere for the PT to find and share.
  const { data: myProfile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: profileService.getProfile,
  });
  const referralCode: string | undefined = myProfile?.profile?.referralCode;

  // For starting a NEW collaboration proposal — CollaborationPanel needs a gymId to propose
  // against, but always shows/responds to existing ones regardless of this selection.
  const [proposeGymId, setProposeGymId] = useState("");
  const { data: allGyms = [] } = useQuery<Gym[]>({
    queryKey: ["all-gyms-for-collab"],
    queryFn: gymService.listGyms,
  });
  const copyReferralCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      toast.success("Đã sao chép mã giới thiệu");
    } catch {
      toast.error("Không sao chép được — chọn thủ công");
    }
  };

  // Read-only summary — editing lives on the real Availability tab at /pt/schedule (which
  // this card used to duplicate with static placeholder days/hours that saved nowhere).
  const { data: availabilityRaw, isLoading: availLoading } = useQuery({
    queryKey: ["pt-availability"],
    queryFn: () => availabilityService.getAvailability("me"),
  });
  const availability = (
    Array.isArray(availabilityRaw) ? availabilityRaw : (availabilityRaw?.data ?? [])
  ) as { dayOfWeek: string; startTime: string; endTime: string; isActive: boolean }[];

  const createPkgMutation = useMutation({
    mutationFn: ptServicePackageService.createPackage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pt-service-packages"] });
      closePkgForm();
      toast.success("Đã tạo gói dịch vụ");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Lỗi tạo gói dịch vụ"),
  });

  const updatePkgMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      ptServicePackageService.updatePackage(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pt-service-packages"] });
      closePkgForm();
      toast.success("Đã cập nhật gói dịch vụ");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Lỗi cập nhật gói dịch vụ"),
  });

  const archivePkgMutation = useMutation({
    mutationFn: (id: string) => ptServicePackageService.archivePackage(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["pt-service-packages"] });
      toast.success(
        res.hasActiveContracts
          ? "Đã lưu trữ gói. Có hợp đồng đang tham chiếu gói này — hợp đồng đó không bị ảnh hưởng."
          : "Đã lưu trữ gói",
      );
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Lỗi lưu trữ gói"),
  });

  const closePkgForm = () => {
    setPkgFormOpen(false);
    setEditingPkgId(null);
    setPkgForm({ ...emptyPkgForm });
  };

  const openAddPkgForm = () => {
    setEditingPkgId(null);
    setPkgForm({ ...emptyPkgForm });
    setPkgFormOpen(true);
  };

  const openEditPkgForm = (pkg: PTServicePackage) => {
    setEditingPkgId(pkg.id);
    setPkgForm({
      name: pkg.name,
      description: pkg.description ?? "",
      sessionCount: String(pkg.sessionCount),
      price: String(Number(pkg.price)),
      sessionMode: pkg.sessionMode,
      sessionDurationMinutes: String(pkg.sessionDurationMinutes),
      validityDays: pkg.validityDays != null ? String(pkg.validityDays) : "",
    });
    setPkgFormOpen(true);
  };

  const submitPkgForm = () => {
    if (!pkgForm.name.trim()) {
      toast.error("Tên gói không được để trống");
      return;
    }
    const sessionCount = Number(pkgForm.sessionCount);
    const price = Number(pkgForm.price);
    if (!Number.isInteger(sessionCount) || sessionCount < 1) {
      toast.error("Số buổi phải là số nguyên >= 1");
      return;
    }
    if (!(price > 0)) {
      toast.error("Giá phải lớn hơn 0");
      return;
    }
    const payload = {
      name: pkgForm.name.trim(),
      description: pkgForm.description.trim() || undefined,
      sessionCount,
      price,
      sessionMode: pkgForm.sessionMode,
      sessionDurationMinutes: pkgForm.sessionDurationMinutes
        ? Number(pkgForm.sessionDurationMinutes)
        : undefined,
      validityDays: pkgForm.validityDays ? Number(pkgForm.validityDays) : undefined,
    };
    if (editingPkgId) updatePkgMutation.mutate({ id: editingPkgId, data: payload });
    else createPkgMutation.mutate(payload);
  };

  const verificationConfig = {
    not_pt: {
      label: "Not PT",
      color: "bg-zinc-700/50 text-zinc-400 border-zinc-700",
    },
    pending: {
      label: "Pending Review",
      color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    approved: {
      label: "Approved PT",
      color: "bg-green-500/10 text-green-400 border-green-500/20",
    },
    rejected: {
      label: "Rejected",
      color: "bg-red-500/10 text-red-400 border-red-500/20",
    },
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100">PT Profile & Services</h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Manage your public profile and coaching packages
          </p>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg ${editing ? "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20" : "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20"}`}
        >
          {editing ? (
            <>
              <Check className="w-4 h-4" /> Save
            </>
          ) : (
            <>
              <Edit3 className="w-4 h-4" /> Edit Profile
            </>
          )}
        </button>
      </div>

      {/* Verification status */}
      <div
        className={`flex items-center gap-3 p-4 rounded-xl border ${verificationStatus === "approved" ? "bg-green-500/8 border-green-500/20" : "bg-amber-500/8 border-amber-500/20"}`}
      >
        <Award
          className={`w-5 h-5 ${verificationStatus === "approved" ? "text-green-400" : "text-amber-400"}`}
        />
        <div>
          <div className="text-sm font-bold text-zinc-200">
            PT Verification Status
          </div>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${verificationConfig[verificationStatus].color}`}
          >
            {verificationConfig[verificationStatus].label}
          </span>
        </div>
        {verificationStatus === "approved" && (
          <div className="ml-auto flex items-center gap-1 text-green-400 text-sm font-bold">
            <Check className="w-4 h-4" /> Verified Coach
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Public profile */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">
              Public Profile
            </h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">
                  Display Name
                </label>
                {editing ? (
                  <input
                    defaultValue="Sarah Mitchell"
                    className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200"
                  />
                ) : (
                  <p className="text-sm font-semibold text-zinc-200 py-2">
                    Sarah Mitchell
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">
                  Bio
                </label>
                {editing ? (
                  <textarea
                    rows={3}
                    defaultValue="Certified NASM personal trainer specializing in evidence-based fat loss and strength development. 6+ years experience coaching online clients worldwide."
                    className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 resize-none"
                  />
                ) : (
                  <p className="text-sm text-zinc-400 py-2 leading-relaxed">
                    Certified NASM personal trainer specializing in
                    evidence-based fat loss and strength development. 6+ years
                    experience coaching online clients worldwide.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">
                    Specialties
                  </label>
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {["Fat Loss", "Strength Training", "HIIT", "Nutrition"].map(
                      (s) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 bg-zinc-800 border border-zinc-700/40 text-zinc-400 text-xs rounded-full"
                        >
                          {s}
                        </span>
                      ),
                    )}
                    {editing && (
                      <button className="px-2 py-0.5 border border-dashed border-green-500/40 text-green-400 text-xs rounded-full">
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">
                    Experience
                  </label>
                  {editing ? (
                    <input
                      defaultValue="6 years"
                      className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-zinc-200 py-2">
                      6 years
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">
                  Certifications
                </label>
                <div className="flex flex-wrap gap-2 py-1">
                  {["NASM CPT", "Precision Nutrition L1", "TRX Certified"].map(
                    (c) => (
                      <span
                        key={c}
                        className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs rounded-full"
                      >
                        <Award className="w-3 h-3" /> {c}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Packages */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-zinc-200">
                Service Packages
              </h4>
              <button
                onClick={openAddPkgForm}
                className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Package
              </button>
            </div>

            {pkgsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
              </div>
            ) : packages.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-6">
                Chưa có gói dịch vụ nào. Thêm gói để khách hàng có thể đăng
                ký.
              </p>
            ) : (
              <div className="space-y-3">
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`p-4 border-2 rounded-xl ${
                      pkg.archivedAt
                        ? "border-zinc-800/60 opacity-50"
                        : "border-zinc-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-zinc-200">
                          {pkg.name}
                        </span>
                        <span className="text-xs text-zinc-600 ml-2">
                          {pkg.sessionCount} buổi ·{" "}
                          {pkg.sessionMode === "ONLINE" ? "Online" : "Offline"} ·{" "}
                          {pkg.sessionDurationMinutes} phút/buổi
                        </span>
                        {pkg.archivedAt && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-zinc-700/50 border border-zinc-600 text-zinc-500 rounded-full">
                            Đã lưu trữ
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-base font-bold text-green-400">
                          {formatVND(Number(pkg.price))}
                        </span>
                        {!pkg.archivedAt && (
                          <>
                            <button
                              onClick={() => openEditPkgForm(pkg)}
                              className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => archivePkgMutation.mutate(pkg.id)}
                              disabled={archivePkgMutation.isPending}
                              className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {pkg.description && (
                      <p className="text-xs text-zinc-400">
                        {pkg.description}
                      </p>
                    )}
                    {pkg.validityDays != null && (
                      <p className="text-[11px] text-zinc-600 mt-1">
                        Hiệu lực {pkg.validityDays} ngày kể từ khi mua
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add/Edit package form */}
            {pkgFormOpen && (
              <div className="mt-4 border-t border-zinc-800/60 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400">
                    {editingPkgId ? "Sửa gói dịch vụ" : "Thêm gói dịch vụ"}
                  </span>
                  <button
                    onClick={closePkgForm}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                      Tên gói *
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={pkgForm.name}
                      onChange={(e) =>
                        setPkgForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="VD: Gói 10 buổi giảm mỡ"
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                      Số buổi *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={pkgForm.sessionCount}
                      onChange={(e) =>
                        setPkgForm((prev) => ({ ...prev, sessionCount: e.target.value }))
                      }
                      placeholder="10"
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                      Giá (VND) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={pkgForm.price}
                      onChange={(e) =>
                        setPkgForm((prev) => ({ ...prev, price: e.target.value }))
                      }
                      placeholder="1000000"
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                      Hình thức
                    </label>
                    <select
                      value={pkgForm.sessionMode}
                      onChange={(e) =>
                        setPkgForm((prev) => ({
                          ...prev,
                          sessionMode: e.target.value as "ONLINE" | "OFFLINE",
                        }))
                      }
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                    >
                      <option value="ONLINE">Online</option>
                      <option value="OFFLINE">Offline</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                      Phút/buổi
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={240}
                      value={pkgForm.sessionDurationMinutes}
                      onChange={(e) =>
                        setPkgForm((prev) => ({
                          ...prev,
                          sessionDurationMinutes: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                      Hiệu lực (ngày, để trống = không giới hạn)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={pkgForm.validityDays}
                      onChange={(e) =>
                        setPkgForm((prev) => ({ ...prev, validityDays: e.target.value }))
                      }
                      placeholder="VD: 90"
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                      Mô tả
                    </label>
                    <textarea
                      rows={2}
                      maxLength={500}
                      value={pkgForm.description}
                      onChange={(e) =>
                        setPkgForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder="Nội dung gói, bao gồm những gì..."
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={closePkgForm}
                    className="flex-1 py-2 border border-zinc-700/60 text-zinc-400 text-sm rounded-lg hover:bg-zinc-800 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={submitPkgForm}
                    disabled={createPkgMutation.isPending || updatePkgMutation.isPending}
                    className="flex-1 py-2 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
                  >
                    {(createPkgMutation.isPending || updatePkgMutation.isPending) && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    {editingPkgId ? "Lưu" : "Thêm"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-4">
          {referralCode && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <h4 className="text-sm font-bold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Gift className="w-4 h-4 text-green-400" /> Mã giới thiệu
              </h4>
              <p className="text-xs text-zinc-500 mb-3">
                Khách dùng mã này khi mua gói hội viên tại phòng gym bạn cộng tác — bạn nhận
                hoa hồng.
              </p>
              <button
                onClick={copyReferralCode}
                className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg hover:border-green-500/40 transition-colors"
              >
                <span className="text-sm font-mono font-bold text-green-400 tracking-wider">
                  {referralCode}
                </span>
                <Copy className="w-3.5 h-3.5 text-zinc-500" />
              </button>
            </div>
          )}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">
              Profile Stats
            </h4>
            <div className="space-y-3">
              {[
                {
                  label: "Rating",
                  value: "4.9",
                  sub: "48 reviews",
                  icon: Star,
                  color: "text-amber-400",
                },
                {
                  label: "Active Clients",
                  value: "14",
                  sub: "this month",
                  icon: null,
                  color: "text-green-400",
                },
                {
                  label: "Sessions Done",
                  value: "342",
                  sub: "total",
                  icon: null,
                  color: "text-blue-400",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between py-2 border-b border-zinc-800/40 last:border-0"
                >
                  <div className="text-sm text-zinc-500">{stat.label}</div>
                  <div className="text-right">
                    <div
                      className={`text-sm font-bold ${stat.color} flex items-center gap-1 justify-end`}
                    >
                      {stat.icon && (
                        <stat.icon className="w-3.5 h-3.5 fill-current" />
                      )}
                      {stat.value}
                    </div>
                    <div className="text-xs text-zinc-600">{stat.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-zinc-200">
                Availability
              </h4>
              <button
                onClick={() => navigate("/pt/schedule")}
                className="text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                Chỉnh sửa
              </button>
            </div>
            {availLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-2">
                {DAY_ORDER.map((day) => {
                  const slot = availability.find((a) => a.dayOfWeek === day && a.isActive);
                  return (
                    <div key={day} className="flex items-center justify-between">
                      <span className={`text-sm ${slot ? "text-zinc-300" : "text-zinc-600"}`}>
                        {DAY_LABELS[day]}
                      </span>
                      {slot ? (
                        <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
                          {slot.startTime} – {slot.endTime}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-600 px-2 py-0.5">
                          Unavailable
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PT ↔ Gym collaboration — component existed, fully built, but was never mounted on
          any page: a PT had no way to reach it at all. */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <label className="text-xs font-semibold text-zinc-500 mb-1.5 block">
          Chọn phòng gym để gửi đề xuất mới (không cần chọn nếu chỉ xem/phản hồi đề xuất đã có)
        </label>
        <select
          value={proposeGymId}
          onChange={(e) => setProposeGymId(e.target.value)}
          className="w-full sm:w-72 px-3 py-2 mb-4 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
        >
          <option value="">-- Không chọn --</option>
          {allGyms.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.city ? ` — ${g.city}` : ""}
            </option>
          ))}
        </select>
        <CollaborationPanel as="PT" gymId={proposeGymId || undefined} />
      </div>

      {/* Training Locations */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-green-400" /> Nơi luyện tập
          </h4>
          <button
            onClick={openAddForm}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold rounded-lg hover:bg-green-500/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Thêm
          </button>
        </div>

        {locsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
          </div>
        ) : locations.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-6">
            Chưa có địa điểm luyện tập. Thêm địa điểm để hiện trên trang tìm
            kiếm PT.
          </p>
        ) : (
          <div className="space-y-2">
            {locations.map((loc) => {
              const parts = [
                loc.gymName,
                loc.ward?.name,
                loc.province.name,
              ].filter(Boolean);
              return (
                <div
                  key={loc.id}
                  className="flex items-center justify-between p-3 bg-zinc-800/40 border border-zinc-700/40 rounded-xl"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-zinc-200">
                        {parts.join(", ")}
                      </span>
                      {loc.isPrimary && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-semibold">
                          Chính
                        </span>
                      )}
                      {!loc.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700/50 border border-zinc-600 text-zinc-500 rounded-full">
                          Ngừng
                        </span>
                      )}
                    </div>
                    {loc.addressLine && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {loc.addressLine}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
                    <button
                      onClick={() => openEditForm(loc)}
                      className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(loc.id)}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add/Edit form */}
        {locFormOpen && (
          <div className="mt-4 border-t border-zinc-800/60 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400">
                {editingLocId ? "Sửa địa điểm" : "Thêm địa điểm"}
              </span>
              <button
                onClick={() => {
                  setLocFormOpen(false);
                  setLocForm({ ...emptyLocForm });
                  setLocWards([]);
                }}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                  Tỉnh/Thành *
                </label>
                <select
                  value={locForm.provinceCode}
                  onChange={(e) => handleLocProvinceChange(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                >
                  <option value="">-- Chọn --</option>
                  {provinces.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {locWards.length > 0 && (
                <div>
                  <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                    Phường/Xã
                  </label>
                  <select
                    value={locForm.wardCode}
                    onChange={(e) =>
                      setLocForm((prev) => ({
                        ...prev,
                        wardCode: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                  >
                    <option value="">-- Chọn --</option>
                    {locWards.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                  Tên phòng gym
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={locForm.gymName}
                  onChange={(e) =>
                    setLocForm((prev) => ({ ...prev, gymName: e.target.value }))
                  }
                  placeholder="VD: California Fitness"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                  Địa chỉ chi tiết
                </label>
                <input
                  type="text"
                  maxLength={255}
                  value={locForm.addressLine}
                  onChange={(e) =>
                    setLocForm((prev) => ({
                      ...prev,
                      addressLine: e.target.value,
                    }))
                  }
                  placeholder="Số nhà, tên đường..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={locForm.isPrimary}
                onChange={(e) =>
                  setLocForm((prev) => ({
                    ...prev,
                    isPrimary: e.target.checked,
                  }))
                }
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-green-500"
              />
              <span className="text-sm text-zinc-400">
                Đặt làm địa điểm chính
              </span>
            </label>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setLocFormOpen(false);
                  setLocForm({ ...emptyLocForm });
                  setLocWards([]);
                }}
                className="flex-1 py-2 border border-zinc-700/60 text-zinc-400 text-sm rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={submitLocForm}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1 py-2 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                {editingLocId ? "Lưu" : "Thêm"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
