import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  CircleNotchIcon as Loader2,
  DownloadSimpleIcon as Download,
  LockSimpleIcon as Lock,
  ReceiptIcon as Receipt,
  HandshakeIcon as Handshake,
  WalletIcon as WalletIc,
} from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { formatVND } from "../../utils/currency";
import { EmptyState, ErrorState } from "../../components/dashboard/DashboardStates";
import { PARTNER_ROLE_LABEL } from "../../utils/gymStaffRole";
import { useStaffRole } from "../../hooks/useStaffRole";
import { recognizedSales, salesCsv, withdrawalsCsv, type SalesRow, type WithdrawalRow } from "../../utils/financeExport";
import {
  COMMISSION_PRESET_LABEL, commissionCsv, commissionRangeFor, monthLabel, normalizePtCommission,
  type CommissionPreset, type PtCommissionSummary,
} from "../../utils/ptCommission";
import type { Gym, Wallet } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Đang dùng",
  EXPIRED: "Hết hạn",
  CANCELLED: "Đã huỷ",
  PENDING_PAYMENT: "Chờ thanh toán",
};
const WITHDRAWAL_LABEL: Record<string, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  PAID: "Đã chi",
  REJECTED: "Từ chối",
};

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("vi-VN") : "—");

function downloadCsv(filename: string, csv: string) {
  // BOM để Excel đọc đúng tiếng Việt.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * D15 / D15b — trang chủ của KẾ TOÁN: CHỈ ĐỌC dữ liệu tài chính của các chi nhánh trong phạm vi được giao (để trống =
 * cả thương hiệu). Doanh số bán thẻ, số dư ví, lịch sử rút tiền, TỔNG hoa hồng PT theo kỳ, xuất CSV. Không có nút
 * ghi/duyệt/rút/hoàn nào — và server cũng từ chối mọi route ghi cho vai trò này. Server đã bỏ danh tính hội viên khỏi
 * doanh số, che số tài khoản nhận tiền, và hoa hồng chỉ ở dạng TỔNG (không theo PT, không tỷ lệ); trang không có nguồn
 * dữ liệu nào khác.
 */
export function GymFinancePage() {
  const { user } = useApp();
  const { role } = useStaffRole();
  const uid = user?.id ?? "guest";
  const [scope, setScope] = useState<string>("ALL");
  const [preset, setPreset] = useState<CommissionPreset>("LAST_6");

  const gymsQuery = useQuery<Gym[]>({ queryKey: ["finance-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const gyms = useMemo(() => (gymsQuery.data ?? []).filter((g) => g.status !== "DRAFT"), [gymsQuery.data]);
  const selected = useMemo(() => (scope === "ALL" ? gyms : gyms.filter((g) => g.id === scope)), [gyms, scope]);

  const brandIds = useMemo(() => [...new Set(selected.map((g) => g.brandId).filter(Boolean) as string[])], [selected]);

  const salesQs = useQueries({
    queries: selected.map((g) => ({
      queryKey: ["finance-sales", uid, g.id],
      queryFn: () => gymService.listOwnedMemberships(g.id) as Promise<SalesRow[]>,
    })),
  });
  const walletQs = useQueries({
    queries: selected.map((g) => ({
      queryKey: ["finance-wallet", uid, g.id],
      queryFn: () => gymService.getOwnedWallet(g.id) as Promise<Wallet>,
    })),
  });
  const withdrawalQs = useQueries({
    queries: selected.map((g) => ({
      queryKey: ["finance-withdrawals", uid, g.id],
      queryFn: () => gymService.listGymWithdrawals(g.id) as Promise<WithdrawalRow[]>,
    })),
  });
  const planQs = useQueries({
    queries: brandIds.map((b) => ({
      queryKey: ["finance-plans", uid, b],
      queryFn: () => gymService.listOwnedPlans(b) as Promise<Array<{ id: string; name: string }>>,
    })),
  });

  // Một chủ = một thương hiệu (xem GymMembershipPlan trong schema gym-service): tổng hoa hồng tính theo thương hiệu của chi nhánh.
  const commissionBrandId = gyms.find((g) => g.brandId)?.brandId ?? "";
  const commissionQuery = useQuery<PtCommissionSummary>({
    queryKey: ["finance-pt-commission", uid, commissionBrandId, scope, preset],
    enabled: !!commissionBrandId,
    queryFn: async () =>
      normalizePtCommission(
        await gymService.getPtCommissionSummary(commissionBrandId, { ...commissionRangeFor(preset), ...(scope === "ALL" ? {} : { gymId: scope }) }),
      ),
  });
  const commission = commissionQuery.data;

  const loading = [...salesQs, ...walletQs, ...withdrawalQs].some((q) => q.isLoading);
  const failed = [...salesQs, ...walletQs, ...withdrawalQs].some((q) => q.isError);

  const gymName = (id: string) => gyms.find((g) => g.id === id)?.name ?? "—";
  const planName = (id: string) => {
    for (const q of planQs) {
      const hit = q.data?.find((p) => p.id === id);
      if (hit) return hit.name;
    }
    return "Gói";
  };

  const sales: SalesRow[] = salesQs.flatMap((q) => q.data ?? []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const withdrawals = withdrawalQs
    .flatMap((q, i) => (q.data ?? []).map((w) => ({ ...w, gymName: selected[i]?.name })))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const recognized = recognizedSales(sales);
  const wallets = walletQs.map((q) => q.data).filter(Boolean) as Wallet[];
  const available = wallets.reduce((s, w) => s + Number(w.availableBalance || 0), 0);
  const pending = wallets.reduce((s, w) => s + Number(w.pendingBalance || 0), 0);

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 md:p-6 max-w-4xl w-full min-w-0 mx-auto space-y-5" data-testid="finance-page">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-zinc-100 text-xl font-bold">Tài chính</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{role ? PARTNER_ROLE_LABEL[role] : ""}</p>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-zinc-500 border border-zinc-800 rounded-full px-2.5 py-1 whitespace-nowrap" data-testid="finance-readonly-badge">
          <Lock className="w-3 h-3" /> Chỉ xem
        </span>
      </div>

      {gymsQuery.isLoading ? (
        <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
      ) : gymsQuery.isError ? (
        <ErrorState message="Không tải được danh sách chi nhánh." />
      ) : gyms.length === 0 ? (
        <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
          <EmptyState icon={WalletIc} title="Chưa có chi nhánh trong phạm vi" hint="Hãy nhờ chủ sở hữu kiểm tra phạm vi được giao cho tài khoản kế toán." />
        </div>
      ) : (
        <>
          <select
            aria-label="Phạm vi chi nhánh"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-200"
          >
            <option value="ALL">Tất cả chi nhánh được giao ({gyms.length})</option>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          {failed && <ErrorState message="Một số số liệu chưa tải được. Thử tải lại trang." />}

          <div className="grid grid-cols-2 gap-3" data-testid="finance-kpis">
            <Kpi label="Doanh số đã thanh toán" value={loading ? "…" : formatVND(recognized.total)} hint={`${recognized.count} thẻ (đang dùng + hết hạn)`} />
            <Kpi label="Số dư khả dụng" value={loading ? "…" : formatVND(available)} hint="Có thể rút" />
            <Kpi label="Chờ ghi nhận" value={loading ? "…" : formatVND(pending)} hint="Giữ tới khi thẻ kết thúc" />
            <Kpi label="Lượt rút tiền" value={loading ? "…" : String(withdrawals.length)} hint="Tất cả trạng thái" />
          </div>

          <section className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-3" data-testid="finance-sales">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-zinc-200 flex items-center gap-2"><Receipt className="w-4 h-4 text-green-400" /> Doanh số bán thẻ</h2>
              <button
                type="button"
                disabled={sales.length === 0}
                onClick={() => downloadCsv(`gymini-doanh-so-${stamp}.csv`, salesCsv(sales, { gym: gymName, plan: planName }))}
                className="flex items-center gap-1.5 text-[11px] font-bold border border-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded-lg disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" /> Xuất CSV
              </button>
            </div>
            {sales.length === 0 ? (
              <p className="text-xs text-zinc-600">{loading ? "Đang tải…" : "Chưa có thẻ nào được bán."}</p>
            ) : (
              <ul className="space-y-1.5">
                {sales.slice(0, 100).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 bg-zinc-800/40 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{planName(s.planId)} · {gymName(s.gymId)}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{fmtDate(s.createdAt)} · {STATUS_LABEL[s.status] ?? s.status}{s.paymentTxnId ? ` · ${s.paymentTxnId.slice(0, 12)}` : ""}</p>
                    </div>
                    <span className="text-sm font-semibold text-zinc-100 whitespace-nowrap">{formatVND(Number(s.priceAtPurchase))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-3" data-testid="finance-commission">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-zinc-200 flex items-center gap-2"><Handshake className="w-4 h-4 text-green-400" /> Hoa hồng giới thiệu PT</h2>
              <button
                type="button"
                disabled={!commission || commission.byMonth.length === 0}
                onClick={() => commission && downloadCsv(`gymini-hoa-hong-pt-${stamp}.csv`, commissionCsv(commission))}
                className="flex items-center gap-1.5 text-[11px] font-bold border border-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded-lg disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" /> Xuất CSV
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">Chỉ hiển thị tổng theo kỳ, không chi tiết từng PT.</p>
            <select
              aria-label="Kỳ hoa hồng"
              value={preset}
              onChange={(e) => setPreset(e.target.value as CommissionPreset)}
              className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
            >
              {(Object.keys(COMMISSION_PRESET_LABEL) as CommissionPreset[]).map((k) => (
                <option key={k} value={k}>{COMMISSION_PRESET_LABEL[k]}</option>
              ))}
            </select>
            {commissionQuery.isLoading ? (
              <p className="text-xs text-zinc-600">Đang tải…</p>
            ) : commissionQuery.isError || !commission ? (
              <ErrorState message="Không tải được hoa hồng PT." />
            ) : (
              <>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2" data-testid="commission-totals">
                  <Kpi label="Dự kiến" value={formatVND(commission.totals.expected)} hint="Chưa chuyển cho PT" />
                  <Kpi label="Đã ghi nhận" value={formatVND(commission.totals.recorded)} hint="Đã vào số dư chờ của PT" />
                  <Kpi label="Đã chi" value={formatVND(commission.totals.paid)} hint="Đã sang số dư khả dụng của PT" />
                </div>
                {commission.totals.clawedBack > 0 && (
                  <p className="text-[11px] text-zinc-500">Đã thu hồi do hoàn tiền thẻ: {formatVND(commission.totals.clawedBack)} (đã trừ khỏi các số trên).</p>
                )}
                {commission.byMonth.length === 0 ? (
                  <p className="text-xs text-zinc-600">Chưa có hoa hồng giới thiệu trong kỳ này.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {commission.byMonth.map((m) => (
                      <li key={m.month} className="bg-zinc-800/40 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-zinc-200">{monthLabel(m.month)}</p>
                          <span className="text-[11px] text-zinc-500 whitespace-nowrap">{m.referralCount} hoa hồng</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 break-words">
                          Dự kiến {formatVND(m.expected)} · ghi nhận {formatVND(m.recorded)} · đã chi {formatVND(m.paid)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="text-[11px] text-zinc-600">
                  <summary className="cursor-pointer select-none">Các con số được tính thế nào</summary>
                  <ul className="mt-1.5 space-y-1 list-disc pl-4">
                    <li><b className="text-zinc-400">Dự kiến:</b> {commission.definitions.expected}</li>
                    <li><b className="text-zinc-400">Đã ghi nhận:</b> {commission.definitions.recorded}</li>
                    <li><b className="text-zinc-400">Đã chi:</b> {commission.definitions.paid}</li>
                    <li><b className="text-zinc-400">Kỳ:</b> {commission.definitions.period}</li>
                  </ul>
                </details>
              </>
            )}
          </section>

          <section className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-3" data-testid="finance-withdrawals">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-zinc-200 flex items-center gap-2"><WalletIc className="w-4 h-4 text-green-400" /> Lịch sử rút tiền</h2>
              <button
                type="button"
                disabled={withdrawals.length === 0}
                onClick={() => downloadCsv(`gymini-rut-tien-${stamp}.csv`, withdrawalsCsv(withdrawals))}
                className="flex items-center gap-1.5 text-[11px] font-bold border border-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded-lg disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" /> Xuất CSV
              </button>
            </div>
            {withdrawals.length === 0 ? (
              <p className="text-xs text-zinc-600">{loading ? "Đang tải…" : "Chưa có yêu cầu rút tiền."}</p>
            ) : (
              <ul className="space-y-1.5">
                {withdrawals.map((w) => (
                  <li key={w.id} className="bg-zinc-800/40 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-zinc-200 truncate">{w.gymName}</p>
                      <span className="text-sm font-semibold text-zinc-100 whitespace-nowrap">{formatVND(Number(w.amount))}</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 break-words">
                      {fmtDate(w.createdAt)} · {WITHDRAWAL_LABEL[w.status] ?? w.status}
                      {w.bankReference ? ` · mã ${w.bankReference}` : ""}
                    </p>
                    {w.payoutInfo && <p className="text-[11px] text-zinc-600 break-words">{w.payoutInfo}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3 min-w-0">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-base font-bold text-zinc-100 mt-1 truncate">{value}</p>
      <p className="text-[10px] text-zinc-600 mt-0.5">{hint}</p>
    </div>
  );
}
