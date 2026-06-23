import { useState } from "react";
import { Award, Edit3, Check, Plus, Star, MapPin, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatVND } from "../../utils/currency";
import { trainingLocationService, locationService } from "../../services/api";

type TrainingLoc = {
  id: string; provinceCode: number; wardCode?: number; gymName?: string;
  addressLine?: string; legacyDistrictName?: string; isPrimary: boolean;
  isActive: boolean; note?: string;
  province: { name: string }; ward?: { name: string };
};

const emptyLocForm = { provinceCode: '', wardCode: '', gymName: '', addressLine: '', isPrimary: false, note: '' };

const verificationConfig = {
  not_pt: { label: "Not PT", color: "bg-zinc-700/50 text-zinc-400 border-zinc-700" },
  pending: { label: "Pending Review", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  approved: { label: "Approved PT", color: "bg-green-500/10 text-green-400 border-green-500/20" },
  rejected: { label: "Rejected", color: "bg-red-500/10 text-red-400 border-red-500/20" },
};

const packages = [
  { name: "Basic", sessions: 4, price: 4000, features: ["4 video sessions", "Workout plan", "Chat support"] },
  { name: "Premium", sessions: 12, price: 10000, features: ["12 video sessions", "Custom meal plan", "Workout plan", "Unlimited chat"] },
];

export function PTProfilePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [verificationStatus] = useState<"pending" | "approved">("approved");

  // Training location management
  const [locFormOpen, setLocFormOpen] = useState(false);
  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [locForm, setLocForm] = useState({ ...emptyLocForm });
  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>([]);
  const [locWards, setLocWards] = useState<{ code: number; name: string }[]>([]);

  const { data: locations = [], isLoading: locsLoading } = useQuery({
    queryKey: ['pt-training-locations'],
    queryFn: trainingLocationService.getMyLocations,
  });

  const createMutation = useMutation({
    mutationFn: trainingLocationService.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pt-training-locations'] }); setLocFormOpen(false); setLocForm({ ...emptyLocForm }); setLocWards([]); toast.success('Đã thêm địa điểm'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi thêm địa điểm'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => trainingLocationService.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pt-training-locations'] }); setEditingLocId(null); setLocFormOpen(false); setLocForm({ ...emptyLocForm }); setLocWards([]); toast.success('Đã cập nhật địa điểm'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi cập nhật địa điểm'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trainingLocationService.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pt-training-locations'] }); toast.success('Đã ẩn địa điểm'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi xóa địa điểm'),
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
    setLocForm({ provinceCode: String(loc.provinceCode), wardCode: String(loc.wardCode ?? ''), gymName: loc.gymName ?? '', addressLine: loc.addressLine ?? '', isPrimary: loc.isPrimary, note: loc.note ?? '' });
    if (!provinces.length) {
      const ps = await locationService.getProvinces().catch(() => []);
      setProvinces(ps);
    }
    if (loc.provinceCode) {
      const ws = await locationService.getWards(loc.provinceCode).catch(() => []);
      setLocWards(ws);
    }
    setLocFormOpen(true);
  };

  const handleLocProvinceChange = async (code: string) => {
    setLocForm(prev => ({ ...prev, provinceCode: code, wardCode: '' }));
    setLocWards(code ? await locationService.getWards(Number(code)).catch(() => []) : []);
  };

  const submitLocForm = () => {
    if (!locForm.provinceCode) { toast.error('Chọn tỉnh/thành'); return; }
    const payload = {
      provinceCode: Number(locForm.provinceCode),
      wardCode: locForm.wardCode ? Number(locForm.wardCode) : undefined,
      gymName: locForm.gymName.trim() || undefined,
      addressLine: locForm.addressLine.trim() || undefined,
      isPrimary: locForm.isPrimary,
      note: locForm.note.trim() || undefined,
    };
    if (editingLocId) updateMutation.mutate({ id: editingLocId, data: payload });
    else createMutation.mutate(payload);
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100">PT Profile & Services</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Manage your public profile and coaching packages</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg ${editing ? "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20" : "bg-green-500 hover:bg-green-400 text-black shadow-green-500/20"}`}
        >
          {editing ? <><Check className="w-4 h-4" /> Save</> : <><Edit3 className="w-4 h-4" /> Edit Profile</>}
        </button>
      </div>

      {/* Verification status */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${verificationStatus === "approved" ? "bg-green-500/8 border-green-500/20" : "bg-amber-500/8 border-amber-500/20"}`}>
        <Award className={`w-5 h-5 ${verificationStatus === "approved" ? "text-green-400" : "text-amber-400"}`} />
        <div>
          <div className="text-sm font-bold text-zinc-200">PT Verification Status</div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${verificationConfig[verificationStatus].color}`}>
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
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Public Profile</h4>
            <div className="space-y-3">
              <div>
                <label htmlFor="ptp-display-name" className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Display Name</label>
                {editing ? <input id="ptp-display-name" defaultValue="Sarah Mitchell" className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200" /> : <p className="text-sm font-semibold text-zinc-200 py-2">Sarah Mitchell</p>}
              </div>
              <div>
                <label htmlFor="ptp-bio" className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Bio</label>
                {editing ? <textarea id="ptp-bio" rows={3} defaultValue="Certified NASM personal trainer specializing in evidence-based fat loss and strength development. 6+ years experience coaching online clients worldwide." className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 resize-none" /> : <p className="text-sm text-zinc-400 py-2 leading-relaxed">Certified NASM personal trainer specializing in evidence-based fat loss and strength development. 6+ years experience coaching online clients worldwide.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Specialties</p>
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {["Fat Loss", "Strength Training", "HIIT", "Nutrition"].map(s => (
                      <span key={s} className="px-2 py-0.5 bg-zinc-800 border border-zinc-700/40 text-zinc-400 text-xs rounded-full">{s}</span>
                    ))}
                    {editing && <button type="button" className="px-2 py-0.5 border border-dashed border-green-500/40 text-green-400 text-xs rounded-full"><Plus className="w-3 h-3" /></button>}
                  </div>
                </div>
                <div>
                  <label htmlFor="ptp-experience" className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Experience</label>
                  {editing ? <input id="ptp-experience" defaultValue="6 years" className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200" /> : <p className="text-sm font-semibold text-zinc-200 py-2">6 years</p>}
                </div>
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Certifications</p>
                <div className="flex flex-wrap gap-2 py-1">
                  {["NASM CPT", "Precision Nutrition L1", "TRX Certified"].map(c => (
                    <span key={c} className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs rounded-full">
                      <Award className="w-3 h-3" /> {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Packages */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-zinc-200">Service Packages</h4>
              {editing && <button type="button" className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"><Plus className="w-3.5 h-3.5" /> Add Package</button>}
            </div>
            <div className="space-y-3">
              {packages.map((pkg, i) => (
                <div key={pkg.name} className={`p-4 border-2 rounded-xl ${i === 1 ? "border-green-500 bg-green-500/5" : "border-zinc-800/60"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-bold text-zinc-200">{pkg.name}</span>
                      <span className="text-xs text-zinc-600 ml-2">{pkg.sessions} sessions</span>
                    </div>
                    {editing ? (
                      <input defaultValue={pkg.price} aria-label={`${pkg.name} package price`} className="w-24 px-2 py-1 border border-zinc-700/60 rounded text-sm text-right font-bold text-green-400 bg-zinc-800/60" />
                    ) : (
                      <span className="text-base font-bold text-green-400">{formatVND(pkg.price)}</span>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {pkg.features.map(f => (
                      <li key={f} className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <Check className="w-3.5 h-3.5 text-green-500" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-4">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Profile Stats</h4>
            <div className="space-y-3">
              {[
                { label: "Rating", value: "4.9", sub: "48 reviews", icon: Star, color: "text-amber-400" },
                { label: "Active Clients", value: "14", sub: "this month", icon: null, color: "text-green-400" },
                { label: "Sessions Done", value: "342", sub: "total", icon: null, color: "text-blue-400" },
              ].map(stat => (
                <div key={stat.label} className="flex items-center justify-between py-2 border-b border-zinc-800/40 last:border-0">
                  <div className="text-sm text-zinc-500">{stat.label}</div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${stat.color} flex items-center gap-1 justify-end`}>
                      {stat.icon && <stat.icon className="w-3.5 h-3.5 fill-current" />}
                      {stat.value}
                    </div>
                    <div className="text-xs text-zinc-600">{stat.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Availability</h4>
            <div className="space-y-2">
              {["Mon", "Tue", "Thu", "Fri"].map(d => (
                <div key={d} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">{d}</span>
                  <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">9am – 5pm</span>
                </div>
              ))}
              {["Wed", "Sat", "Sun"].map(d => (
                <div key={d} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600">{d}</span>
                  <span className="text-xs text-zinc-600 px-2 py-0.5">Unavailable</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Training Locations */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2"><MapPin className="w-4 h-4 text-green-400" /> Nơi luyện tập</h4>
          <button type="button" onClick={openAddForm} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold rounded-lg hover:bg-green-500/20 transition-all">
            <Plus className="w-3.5 h-3.5" /> Thêm
          </button>
        </div>

        {locsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-green-400 animate-spin" /></div>
        ) : locations.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-6">Chưa có địa điểm luyện tập. Thêm địa điểm để hiện trên trang tìm kiếm PT.</p>
        ) : (
          <div className="space-y-2">
            {locations.map((loc) => {
              const parts = [loc.gymName, loc.ward?.name, loc.province.name].filter(Boolean);
              return (
                <div key={loc.id} className="flex items-center justify-between p-3 bg-zinc-800/40 border border-zinc-700/40 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-zinc-200">{parts.join(', ')}</span>
                      {loc.isPrimary && <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-semibold">Chính</span>}
                      {!loc.isActive && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700/50 border border-zinc-600 text-zinc-500 rounded-full">Ngừng</span>}
                    </div>
                    {loc.addressLine && <p className="text-xs text-zinc-500 mt-0.5">{loc.addressLine}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
                    <button type="button" onClick={() => openEditForm(loc)} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => deleteMutation.mutate(loc.id)} disabled={deleteMutation.isPending} className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
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
              <span className="text-xs font-semibold text-zinc-400">{editingLocId ? 'Sửa địa điểm' : 'Thêm địa điểm'}</span>
              <button type="button" onClick={() => { setLocFormOpen(false); setLocForm({ ...emptyLocForm }); setLocWards([]); }} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ptp-loc-province" className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Tỉnh/Thành *</label>
                <select id="ptp-loc-province" value={locForm.provinceCode} onChange={e => handleLocProvinceChange(e.target.value)} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none">
                  <option value="">-- Chọn --</option>
                  {provinces.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
              </div>
              {locWards.length > 0 && (
                <div>
                  <label htmlFor="ptp-loc-ward" className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Phường/Xã</label>
                  <select id="ptp-loc-ward" value={locForm.wardCode} onChange={e => setLocForm(prev => ({ ...prev, wardCode: e.target.value }))} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none">
                    <option value="">-- Chọn --</option>
                    {locWards.map(w => <option key={w.code} value={w.code}>{w.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="ptp-loc-gymname" className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Tên phòng gym</label>
                <input id="ptp-loc-gymname" type="text" maxLength={120} value={locForm.gymName} onChange={e => setLocForm(prev => ({ ...prev, gymName: e.target.value }))} placeholder="VD: California Fitness" className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none" />
              </div>
              <div>
                <label htmlFor="ptp-loc-address" className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Địa chỉ chi tiết</label>
                <input id="ptp-loc-address" type="text" maxLength={255} value={locForm.addressLine} onChange={e => setLocForm(prev => ({ ...prev, addressLine: e.target.value }))} placeholder="Số nhà, tên đường..." className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={locForm.isPrimary} onChange={e => setLocForm(prev => ({ ...prev, isPrimary: e.target.checked }))} className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-green-500" />
              <span className="text-sm text-zinc-400">Đặt làm địa điểm chính</span>
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setLocFormOpen(false); setLocForm({ ...emptyLocForm }); setLocWards([]); }} className="flex-1 py-2 border border-zinc-700/60 text-zinc-400 text-sm rounded-lg hover:bg-zinc-800 transition-colors">Hủy</button>
              <button type="button" onClick={submitLocForm} disabled={createMutation.isPending || updateMutation.isPending} className="flex-1 py-2 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-white text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5">
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editingLocId ? 'Lưu' : 'Thêm'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}