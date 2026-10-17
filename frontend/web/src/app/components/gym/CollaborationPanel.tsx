import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandshakeIcon as Handshake, CircleNotchIcon as Loader2, CheckIcon as Check, XIcon as X, RepeatIcon as Repeat, TrashIcon as Trash2, WarningIcon as AlertTriangle, StorefrontIcon as Storefront } from "@phosphor-icons/react";
import { toast } from "sonner";
import { collaborationService, gymService, profileService } from "../../services/api";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import {
  COVERAGE_COPY,
  LEGACY_OPEN_OFFER_NOTE,
  PT_NAME_FALLBACK,
  SIGNED_CONTRACTS_NOTE,
  brandOptionsFromGyms,
  brandsBlockedForProposal,
  buildPartnershipSections,
  optionLabel,
  optionNote,
  ownerIntroCopy,
  ownerProposalOptions,
  percentLabel,
  proposeCopy,
  ptDisplayName,
  ratesLine,
  terminateBrandCopy,
  terminatedToast,
  type BrandAgreementView,
  type BrandOption,
  type LegacyGroupView,
  type LegacyRowView,
  type PartnershipCard,
  type Tone,
  type Viewer,
} from "../../utils/brandPartnership";

/**
 * PT <-> Gym revenue-split partnership, at the BRAND level (decisions D5-D9, D72).
 *
 * One PT + one brand = one agreement = one set of terms for every open branch. So this panel proposes,
 * negotiates, accepts and ends the agreement with the BRAND; the branches it covers are listed but never
 * priced separately. Old per-branch terms (legacy) are drawn as such and never merged. All the mapping lives
 * in utils/brandPartnership.ts (unit-tested); the server stays the authority for turns, notice periods and
 * who may see terms (branch managers get 403).
 *
 * Both sides use this panel; `as` decides which endpoints are called and whose turn it is. A side that has
 * just made an offer cannot accept it itself (the server answers 409), so the turn is shown explicitly.
 */

const TONE_CLS: Record<Tone, string> = {
  success: "bg-green-500/10 text-green-400 border-green-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  danger: "bg-red-500/10 text-red-400 border-red-500/20",
  neutral: "bg-zinc-700/50 text-zinc-400 border-zinc-700",
  info: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const PLATFORM_PCT = 10;
const INPUT_CLS =
  "w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50";

type Dialog =
  | { type: "propose"; brandId?: string; ptUserId?: string; ptName?: string; doorBranchId?: string; repartner?: boolean }
  | { type: "counter"; id: string; title: string; round: number; pt: string | null; gym: string | null; branchOnly?: boolean }
  | { type: "terminate"; id: string; title: string; lines: string[]; immediate: boolean };

const errMessage = (e: any) =>
  e?.response?.data?.error?.message || (typeof e?.response?.data?.error === "string" ? e.response.data.error : "") || "Thao tác thất bại";

const toPct = (fraction: string | null, fallback: string) => (fraction == null ? fallback : String(Math.round(Number(fraction) * 100)));

function Chip({ children, cls = "bg-zinc-800/60 text-zinc-300" }: { children: React.ReactNode; cls?: string }) {
  return <span className={`px-2 py-1 rounded text-xs ${cls}`}>{children}</span>;
}

export function CollaborationPanel({ as }: { as: Viewer }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [ptRate, setPtRate] = useState("55");
  const [gymRate, setGymRate] = useState("35");
  const [brandId, setBrandId] = useState("");
  const [inviteePtId, setInviteePtId] = useState("");
  const [ptSearch, setPtSearch] = useState("");
  // One dialog serves every flow; Back closes whichever is open.
  useBackDismissible(!!dialog, () => setDialog(null));

  const queryKey = ["collaborations", as];
  const { data: rawRows, isLoading, error: listError } = useQuery<any[]>({
    queryKey,
    queryFn: () => (as === "GYM" ? collaborationService.listForOwner() : collaborationService.listMine()),
    retry: false,
  });
  const sections = useMemo(() => buildPartnershipSections(rawRows, as), [rawRows, as]);
  const all: PartnershipCard[] = [...sections.needsReply, ...sections.current, ...sections.ended];

  // The owner's cards name the trainer: look the names up (cached per id), never print an id.
  const ptIds = useMemo(
    () => (as === "GYM" ? [...new Set(all.map((c) => c.ptUserId).filter(Boolean))] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [as, rawRows],
  );
  const nameQueries = useQueries({
    queries: ptIds.map((id) => ({
      queryKey: ["pt-display-name", id],
      queryFn: async () => ptDisplayName(await profileService.getPTDetail(id)),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const ptNames = new Map<string, string>(ptIds.map((id, i) => [id, nameQueries[i]?.data ?? PT_NAME_FALLBACK]));
  const nameOf = (id: string) => ptNames.get(id) ?? PT_NAME_FALLBACK;

  // What a new proposal can be addressed to.
  const proposing = dialog?.type === "propose";
  const { data: publicGyms } = useQuery<any[]>({
    queryKey: ["all-gyms-for-collab"],
    queryFn: gymService.listGyms,
    enabled: proposing && as === "PT",
  });
  const { data: ownedGyms } = useQuery<any[]>({
    queryKey: ["owned-gyms-for-collab"],
    queryFn: gymService.listOwnedGyms,
    enabled: as === "GYM",
  });
  const brandOptions: BrandOption[] = useMemo(() => {
    if (as === "PT") return brandOptionsFromGyms(publicGyms);
    return ownerProposalOptions(ownedGyms);
  }, [as, publicGyms, ownedGyms]);
  const blocked = useMemo(() => brandsBlockedForProposal(rawRows), [rawRows]);
  const { data: ptHits = [], isFetching: searching } = useQuery<{ userId: string; name: string }[]>({
    queryKey: ["collab-pt-search", ptSearch.trim()],
    queryFn: async () => {
      const res = await profileService.listPTs({ q: ptSearch.trim(), limit: 8 });
      const list = Array.isArray(res?.pts) ? res.pts : Array.isArray(res) ? res : [];
      return list.map((p: any) => ({ userId: String(p?.userId ?? p?.id ?? ""), name: ptDisplayName(p) })).filter((p: any) => p.userId);
    },
    enabled: proposing && as === "GYM" && ptSearch.trim().length >= 2 && !inviteePtId,
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const onError = (e: any) => toast.error(errMessage(e));

  const sum = Number(ptRate) + Number(gymRate) + PLATFORM_PCT;
  const sumOk = Math.abs(sum - 100) < 1e-9;
  const ratesBody = () => ({
    ptRate: (Number(ptRate) / 100).toFixed(4),
    gymRate: (Number(gymRate) / 100).toFixed(4),
    platformRate: (PLATFORM_PCT / 100).toFixed(4),
  });

  const respond = useMutation({
    mutationFn: (v: { id: string; action: "ACCEPT" | "REJECT" | "COUNTER" }) =>
      collaborationService.respond(v.id, as, { action: v.action, ...(v.action === "COUNTER" ? ratesBody() : {}) }),
    onSuccess: (_d, v) => {
      toast.success(v.action === "ACCEPT" ? "Đã chấp nhận hợp tác" : v.action === "REJECT" ? "Đã từ chối" : "Đã gửi đề xuất mới");
      setDialog(null);
      invalidate();
    },
    onError,
  });

  const propose = useMutation({
    mutationFn: (v: { doorBranchId: string; ptUserId: string }) =>
      as === "GYM"
        ? collaborationService.proposeAsGym(v.doorBranchId, { ...ratesBody(), ptUserId: v.ptUserId })
        : collaborationService.proposeAsPt(v.doorBranchId, ratesBody()),
    onSuccess: () => {
      toast.success("Đã gửi đề xuất hợp tác");
      setDialog(null);
      setInviteePtId("");
      setPtSearch("");
      invalidate();
    },
    onError,
  });

  const terminate = useMutation({
    mutationFn: (id: string) => collaborationService.terminate(id, as),
    onSuccess: (result) => {
      toast.success(terminatedToast(result));
      setDialog(null);
      invalidate();
    },
    onError,
  });

  const openPropose = (init: Partial<Extract<Dialog, { type: "propose" }>> = {}) => {
    setPtRate("55");
    setGymRate("35");
    setInviteePtId(init.ptUserId ?? "");
    setPtSearch(init.ptName ?? "");
    setBrandId(init.brandId ?? "");
    setDialog({ type: "propose", ...init });
  };

  // PT: the option picked in the select. Owner: the picked one, else their first (usually the only: their brand).
  const selectedBrand = brandOptions.find((b) => b.brandId === (brandId || (as === "GYM" ? brandOptions[0]?.brandId : "")));
  const doorBranchId = dialog?.type === "propose" ? (dialog.doorBranchId ?? selectedBrand?.proposeBranchId ?? "") : "";
  const proposePtId = as === "GYM" ? inviteePtId : "";
  const canSubmitPropose =
    dialog?.type === "propose" && !!doorBranchId && sumOk && (as === "PT" || !!proposePtId) && !propose.isPending;

  const forbidden = (listError as any)?.response?.status === 403;
  // A brandless gym's agreement is a single-branch one (D8): never say its rates cover "every branch of the brand".
  const branchOnly = dialog?.type === "counter" ? !!dialog.branchOnly : selectedBrand?.scope === "BRANCH";

  // ---------------------------------------------------------------- cards
  const renderBranches = (c: BrandAgreementView) =>
    c.branches.length > 0 && (
      <div data-testid="collab-covered-branches" className="space-y-1">
        <p className="text-[11px] text-zinc-500">
          Chi nhánh áp dụng ({c.branches.length}) — {COVERAGE_COPY}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {c.branches.map((b) => (
            <span key={b.id} className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800/60 text-zinc-300 border border-zinc-700/50">
              {b.name}
              {b.closed ? " · tạm đóng" : ""}
            </span>
          ))}
        </div>
      </div>
    );

  const renderBrandCard = (c: BrandAgreementView) => {
    const title = as === "PT" ? c.brandName : nameOf(c.ptUserId);
    const sub = as === "PT" ? "Thương hiệu" : `Thương hiệu ${c.brandName}`;
    return (
      <div key={c.id} data-testid="collab-card-brand" className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-200 truncate">{title}</p>
            <p className="text-[11px] text-zinc-600 truncate">{sub}</p>
          </div>
          <span data-testid="collab-status" className={`text-xs px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap ${TONE_CLS[c.tone]}`}>
            {c.label}
          </span>
        </div>

        <div className="flex flex-wrap gap-2" data-testid="collab-rates">
          <Chip>PT {c.rates.pt}</Chip>
          <Chip>Gym {c.rates.gym}</Chip>
          <Chip cls="bg-zinc-800/60 text-zinc-500">Nền tảng {c.rates.platform}</Chip>
        </div>
        <p className="text-[11px] text-zinc-600">Tỷ lệ chung cho mọi chi nhánh của thương hiệu.</p>

        {renderBranches(c)}

        {(c.stage === "MY_TURN" || c.stage === "THEIR_TURN") && (
          <div className="text-[11px] text-zinc-600">
            Vòng {c.round}
            {c.expiresAt ? ` · hạn ${new Date(c.expiresAt).toLocaleDateString("vi-VN")}` : ""}
          </div>
        )}
        {c.noticeLine && (
          <div data-testid="collab-notice" className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Hiệu lực chấm dứt: <b>{c.effectiveDate}</b>. {c.noticeLine}
            </span>
          </div>
        )}
        {c.stage === "TERMINATED" && c.terminatedDate && <p className="text-[11px] text-zinc-600">Chấm dứt ngày {c.terminatedDate}.</p>}
        {c.note && <p className="text-xs text-zinc-500 italic">“{c.note}”</p>}

        {c.canRespond && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" data-testid="collab-accept" onClick={() => respond.mutate({ id: c.id, action: "ACCEPT" })} disabled={respond.isPending}
              className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-1.5 rounded-lg text-xs font-bold">
              <Check className="w-3.5 h-3.5" /> Chấp nhận
            </button>
            <button type="button" data-testid="collab-counter"
              onClick={() => {
                setPtRate(toPct(c.raw.pt, "55"));
                setGymRate(toPct(c.raw.gym, "35"));
                setDialog({ type: "counter", id: c.id, title: title, round: c.round, pt: c.raw.pt, gym: c.raw.gym });
              }}
              className="flex items-center gap-1 border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium">
              <Repeat className="w-3.5 h-3.5" /> Đề xuất lại
            </button>
            <button type="button" data-testid="collab-reject" onClick={() => respond.mutate({ id: c.id, action: "REJECT" })} disabled={respond.isPending}
              className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium">
              <X className="w-3.5 h-3.5" /> Từ chối
            </button>
          </div>
        )}

        {c.canTerminate && (
          <button type="button" data-testid="collab-terminate"
            onClick={() => {
              const copy = terminateBrandCopy(as, title === PT_NAME_FALLBACK ? "" : title);
              setDialog({ type: "terminate", id: c.id, title: copy.title, lines: copy.lines, immediate: false });
            }}
            className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium mt-1">
            <Trash2 className="w-3.5 h-3.5" /> Chấm dứt hợp tác
          </button>
        )}

        {c.canRepartner && (
          <button type="button" data-testid="collab-repartner"
            onClick={() =>
              openPropose({ brandId: c.brandId, ptUserId: c.ptUserId, ptName: as === "GYM" ? nameOf(c.ptUserId) : undefined, doorBranchId: c.proposeBranchId ?? undefined, repartner: true })
            }
            className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold mt-1">
            <Handshake className="w-3.5 h-3.5" /> Hợp tác lại
          </button>
        )}
      </div>
    );
  };

  const renderLegacyRow = (g: LegacyGroupView, r: LegacyRowView) => (
    <div key={r.id} data-testid="collab-legacy-row" className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-zinc-200 truncate max-w-full">{r.branchName}</p>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap ${TONE_CLS[r.tone]}`}>{r.label}</span>
      </div>
      <p className="text-[11px] text-zinc-500">{r.ratesCaption}: {ratesLine(r.rates)}</p>
      {r.stage === "TERMINATING" && r.effectiveDate && <p className="text-[11px] text-amber-400">Chấm dứt ngày {r.effectiveDate}.</p>}
      {r.stage === "MY_TURN" && !r.canAcceptOrCounter && <p className="text-[11px] text-zinc-500">{LEGACY_OPEN_OFFER_NOTE}</p>}
      <div className="flex flex-wrap gap-2">
        {r.canAcceptOrCounter && (
          <>
            <button type="button" onClick={() => respond.mutate({ id: r.id, action: "ACCEPT" })} disabled={respond.isPending}
              className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-1.5 rounded-lg text-xs font-bold">
              <Check className="w-3.5 h-3.5" /> Chấp nhận
            </button>
            <button type="button"
              onClick={() => {
                setPtRate(toPct(r.raw.pt, "55"));
                setGymRate(toPct(r.raw.gym, "35"));
                setDialog({ type: "counter", id: r.id, title: r.branchName, round: r.round, pt: r.raw.pt, gym: r.raw.gym, branchOnly: !g.branded });
              }}
              className="flex items-center gap-1 border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium">
              <Repeat className="w-3.5 h-3.5" /> Đề xuất lại
            </button>
          </>
        )}
        {r.canReject && (
          <button type="button" data-testid="collab-legacy-reject" onClick={() => respond.mutate({ id: r.id, action: "REJECT" })} disabled={respond.isPending}
            className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium">
            <X className="w-3.5 h-3.5" /> Từ chối
          </button>
        )}
        {r.canTerminate && (
          <button type="button" data-testid="collab-legacy-terminate"
            onClick={() => {
              setDialog({ type: "terminate", id: r.id, title: r.terminateCopy.title, lines: r.terminateCopy.lines, immediate: true });
            }}
            className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium">
            <Trash2 className="w-3.5 h-3.5" /> {r.terminateLabel}
          </button>
        )}
      </div>
    </div>
  );

  const renderLegacyGroup = (g: LegacyGroupView) => {
    const title = as === "PT" ? g.brandName : nameOf(g.ptUserId);
    return (
      <div key={g.key} data-testid="collab-card-legacy" className="bg-zinc-900 rounded-xl border border-amber-500/20 p-4 space-y-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-200 truncate">{title}</p>
          <p className="text-[11px] text-zinc-600 truncate">{g.branded ? `Thương hiệu ${g.brandName}` : "Chi nhánh chưa có thương hiệu"}</p>
        </div>
        <div data-testid="collab-legacy-headline" className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <b>{g.headline}</b>
            {g.detail ? <><br />{g.detail}</> : null}
          </span>
        </div>
        <div className="space-y-2">{g.rows.map((r) => renderLegacyRow(g, r))}</div>
        {g.canProposeJoint && (
          <button type="button" data-testid="collab-propose-joint"
            onClick={() =>
              openPropose({ brandId: g.brandId ?? undefined, ptUserId: g.ptUserId, ptName: as === "GYM" ? nameOf(g.ptUserId) : undefined, doorBranchId: g.proposeBranchId ?? undefined })
            }
            className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold">
            <Storefront className="w-3.5 h-3.5" /> Đề xuất thỏa thuận chung cho thương hiệu
          </button>
        )}
      </div>
    );
  };

  const renderCard = (c: PartnershipCard) => (c.kind === "BRAND" ? renderBrandCard(c) : renderLegacyGroup(c));
  const Section = ({ id, title, cards }: { id: string; title: string; cards: PartnershipCard[] }) =>
    cards.length === 0 ? null : (
      <section data-testid={`collab-section-${id}`} className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
        {cards.map(renderCard)}
      </section>
    );

  const hasAny = all.length > 0;
  const canPropose = as === "PT" || brandOptions.length > 0;

  return (
    <div className="space-y-3" data-testid="collab-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-zinc-100 font-bold flex items-center gap-2">
          <Handshake className="w-4 h-4 text-green-400" /> Hợp tác chia doanh thu
        </h3>
        {!forbidden && canPropose && (
          <button type="button" data-testid="collab-propose-open" onClick={() => openPropose()}
            className="bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap">
            {as === "GYM" ? "Mời huấn luyện viên" : "Đề nghị hợp tác"}
          </button>
        )}
      </div>

      <p className="text-[11px] text-zinc-600 leading-snug">
        {as === "GYM" ? ownerIntroCopy(brandOptions) : <>Thỏa thuận được ký với <span className="text-zinc-400">cả thương hiệu</span> và áp dụng một bộ tỷ lệ cho mọi chi nhánh đang mở.</>} {SIGNED_CONTRACTS_NOTE}
      </p>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
        </div>
      )}

      {forbidden && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-sm text-zinc-500">
          Chỉ chủ phòng gym mới xem được điều khoản hợp tác.
        </div>
      )}
      {!isLoading && listError && !forbidden && (
        <div className="bg-zinc-900 rounded-xl border border-red-500/20 p-6 text-center text-sm text-red-400">Không tải được danh sách hợp tác. Thử tải lại trang.</div>
      )}

      {!isLoading && !listError && !hasAny && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-8 text-center text-sm text-zinc-500">Chưa có hợp tác nào.</div>
      )}

      <Section id="needs-reply" title="Cần bạn trả lời" cards={sections.needsReply} />
      <Section id="current" title="Đang hiệu lực / đang chờ" cards={sections.current} />
      <Section id="ended" title="Đã kết thúc" cards={sections.ended} />

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
            {dialog.type === "terminate" ? (
              <>
                <div className="p-5 border-b border-zinc-800/60">
                  <h3 data-testid="collab-terminate-title" className="text-zinc-100 font-bold">{dialog.title}</h3>
                </div>
                <ul className="p-5 space-y-2 text-sm text-zinc-400 list-disc list-inside">
                  {dialog.lines.map((l) => <li key={l}>{l}</li>)}
                </ul>
                <div className="p-5 border-t border-zinc-800/60 flex gap-3">
                  <button type="button" onClick={() => setDialog(null)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800">Không</button>
                  <button type="button" data-testid="collab-terminate-confirm" disabled={terminate.isPending} onClick={() => terminate.mutate(dialog.id)}
                    className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:opacity-60 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2">
                    {terminate.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    Chấm dứt
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-5 border-b border-zinc-800/60">
                  <h3 className="text-zinc-100 font-bold">
                    {dialog.type === "counter" ? `Đề xuất lại (vòng ${dialog.round + 1})` : proposeCopy(as, !!dialog.repartner).title}
                  </h3>
                  {dialog.type === "counter" && <p className="text-xs text-zinc-500 mt-1">{dialog.title}</p>}
                </div>
                <div className="p-5 space-y-3">
                  {dialog.type === "propose" && as === "PT" && (
                    <div>
                      <label className="text-xs font-semibold text-zinc-400 mb-1 block" htmlFor="collab-brand">Hợp tác với</label>
                      <select id="collab-brand" data-testid="collab-brand-select" value={brandId} disabled={!!dialog.repartner || !!dialog.brandId}
                        onChange={(e) => setBrandId(e.target.value)} className={INPUT_CLS}>
                        <option value="">-- Chọn thương hiệu --</option>
                        {brandOptions.map((b) => (
                          <option key={b.brandId} value={b.brandId} disabled={blocked.has(b.brandId)}>
                            {optionLabel(b)}{blocked.has(b.brandId) ? " — đã có đề xuất/thỏa thuận" : ""}
                          </option>
                        ))}
                      </select>
                      {selectedBrand && (
                        <p data-testid="collab-option-note" className="text-[11px] text-zinc-500 mt-1">{optionNote(selectedBrand)}</p>
                      )}
                    </div>
                  )}
                  {dialog.type === "propose" && as === "GYM" && (
                    <>
                      {brandOptions.length > 1 && (
                        <div>
                          <label className="text-xs font-semibold text-zinc-400 mb-1 block" htmlFor="collab-brand-owner">Hợp tác cho</label>
                          <select id="collab-brand-owner" data-testid="collab-brand-select" value={selectedBrand?.brandId ?? ""} disabled={!!dialog.repartner || !!dialog.brandId}
                            onChange={(e) => setBrandId(e.target.value)} className={INPUT_CLS}>
                            {brandOptions.map((b) => (
                              <option key={b.brandId} value={b.brandId}>{optionLabel(b)}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {selectedBrand && (
                        <p data-testid="collab-option-note" className="text-xs text-zinc-400">
                          {selectedBrand.scope === "BRAND" ? (
                            <>Thương hiệu: <span className="text-zinc-200 font-semibold">{selectedBrand.brandName}</span> — </>
                          ) : (
                            <><span className="text-zinc-200 font-semibold">{selectedBrand.brandName}</span> — </>
                          )}
                          {optionNote(selectedBrand)}
                        </p>
                      )}
                      <div>
                        <label className="text-xs font-semibold text-zinc-400 mb-1 block" htmlFor="collab-pt-search">Huấn luyện viên</label>
                        <input id="collab-pt-search" data-testid="collab-pt-search" value={ptSearch} disabled={!!dialog.repartner || !!dialog.ptUserId}
                          onChange={(e) => { setPtSearch(e.target.value); setInviteePtId(""); }}
                          placeholder="Gõ tên huấn luyện viên để tìm" className={INPUT_CLS} />
                        {inviteePtId ? (
                          <p className="text-[11px] text-green-400 mt-1">Đã chọn: {ptSearch}</p>
                        ) : ptSearch.trim().length >= 2 ? (
                          <ul className="mt-1 rounded-lg border border-zinc-700/60 divide-y divide-zinc-800 max-h-40 overflow-y-auto">
                            {searching && <li className="px-3 py-2 text-xs text-zinc-500">Đang tìm…</li>}
                            {!searching && ptHits.length === 0 && <li className="px-3 py-2 text-xs text-zinc-500">Không tìm thấy huấn luyện viên.</li>}
                            {ptHits.map((p) => (
                              <li key={p.userId}>
                                <button type="button" data-testid="collab-pt-option" onClick={() => { setInviteePtId(p.userId); setPtSearch(p.name); }}
                                  className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800">{p.name}</button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-zinc-400 mb-1 block" htmlFor="collab-pt-rate">PT (%)</label>
                      <input id="collab-pt-rate" type="number" value={ptRate} onChange={(e) => setPtRate(e.target.value)} className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-zinc-400 mb-1 block" htmlFor="collab-gym-rate">Phòng gym (%)</label>
                      <input id="collab-gym-rate" type="number" value={gymRate} onChange={(e) => setGymRate(e.target.value)} className={INPUT_CLS} />
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Nền tảng giữ cố định <span className="text-zinc-300">{percentLabel(PLATFORM_PCT / 100)}</span>. Tổng hiện tại:{" "}
                    <span className={sumOk ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{sum}%</span>. {branchOnly ? "Tỷ lệ này chỉ áp dụng riêng cho chi nhánh này." : "Bộ tỷ lệ này áp dụng cho mọi chi nhánh của thương hiệu."}
                  </div>
                  {!sumOk && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      Tổng ba tỷ lệ phải bằng đúng 100%. Máy chủ sẽ từ chối nếu lệch, kể cả lệch rất nhỏ.
                    </div>
                  )}
                </div>
                <div className="p-5 border-t border-zinc-800/60 flex gap-3">
                  <button type="button" onClick={() => setDialog(null)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800">Huỷ</button>
                  <button type="button" data-testid="collab-submit"
                    disabled={dialog.type === "counter" ? !sumOk || respond.isPending : !canSubmitPropose}
                    onClick={() =>
                      dialog.type === "counter"
                        ? respond.mutate({ id: dialog.id, action: "COUNTER" })
                        : propose.mutate({ doorBranchId, ptUserId: proposePtId })
                    }
                    className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg flex items-center justify-center gap-2">
                    {(propose.isPending || respond.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                    Gửi
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
