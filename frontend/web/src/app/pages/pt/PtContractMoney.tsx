import { useQuery } from "@tanstack/react-query";
import { CircleNotchIcon as Loader2, LockKeyIcon, ClockIcon } from "@phosphor-icons/react";
import { contractService } from "../../services/api";
import { ptWalletContractsService } from "../../services/ptWalletContracts";
import { formatVND } from "../../utils/currency";
import {
  HOLDBACK_RELEASE_CONDITION,
  contractTitle,
  earnedPercent,
  holdbackBadge,
  holdbackNote,
  num,
  type PtWalletContractRow,
  type PtWalletContractsView,
} from "./ptWalletContracts.utils";

const BADGE_TONE: Record<"info" | "warn" | "ok", string> = {
  info: "bg-sky-500/10 text-sky-300 border-sky-500/20",
  warn: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  ok: "bg-green-500/10 text-green-300 border-green-500/20",
};

function Figure({ label, value, testId, hint }: { label: string; value: string; testId: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-zinc-500 leading-tight">{label}</div>
      <div data-testid={testId} data-value={value} className="text-sm font-semibold text-zinc-100 break-words">
        {formatVND(num(value))}
      </div>
      {hint && <div className="text-[10px] text-zinc-600 leading-tight">{hint}</div>}
    </div>
  );
}

function ContractCard({ row, packageName }: { row: PtWalletContractRow; packageName?: string | null }) {
  const note = holdbackNote(row);
  const badge = holdbackBadge(row);
  const pct = earnedPercent(row);
  return (
    <div
      data-testid="pt-contract-money-card"
      data-held={row.held}
      data-state={row.release.state}
      className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3.5 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100 break-words">{contractTitle(row, packageName)}</div>
          <div className="text-[11px] text-zinc-500">Giá trị hợp đồng {formatVND(num(row.contractValue))}</div>
        </div>
        {badge && (
          <span data-testid="pt-contract-money-badge" className={`text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${BADGE_TONE[badge.tone]}`}>
            {badge.label}
          </span>
        )}
      </div>

      <div>
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Đã kiếm trên thu nhập dự kiến">
          <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[11px] text-zinc-500 mt-1">Đã kiếm {pct}% thu nhập dự kiến của hợp đồng này</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2.5">
        <Figure testId="pt-contract-expected" label="Thu nhập dự kiến của bạn" value={row.expectedIncome} hint="Nếu bạn dạy đủ các buổi" />
        <Figure testId="pt-contract-pending" label="Chưa kiếm" value={row.pending} hint="Các buổi chưa diễn ra" />
        <Figure testId="pt-contract-earned" label="Đã kiếm" value={row.earned} hint="Đã vào số dư + đang tạm giữ" />
        <Figure testId="pt-contract-held" label="Đang tạm giữ" value={row.held} hint="Của bạn, chưa rút được" />
        <Figure testId="pt-contract-available" label="Đã chuyển vào số dư" value={row.availableFromContract} hint="Rút được" />
        {num(row.compensationPaid) > 0 && (
          <Figure testId="pt-contract-compensation" label="Đã dùng để bồi thường khách" value={row.compensationPaid} hint="Do hợp đồng này kết thúc vì lỗi của PT" />
        )}
      </div>

      {note && (
        <div data-testid="pt-contract-holdback-note" className="flex items-start gap-1.5 text-[11px] text-zinc-400 leading-snug">
          {row.release.heldDueToDispute ? <ClockIcon className="w-3.5 h-3.5 mt-px flex-shrink-0 text-amber-400" /> : <LockKeyIcon className="w-3.5 h-3.5 mt-px flex-shrink-0 text-sky-400" />}
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}

/**
 * FH-9: the PT's money per contract. Derived from the ledger by payment-service (read only). Shows what is not earned yet, what is
 * earned, what is held back (earned, not withdrawable) and the CONDITION under which it comes back - never a fixed date.
 */
export function PtContractMoney() {
  const { data, isLoading, isError } = useQuery<PtWalletContractsView>({
    queryKey: ["pt-wallet-contracts"],
    queryFn: () => ptWalletContractsService.get(),
  });
  // Package names make the cards readable; if this lookup fails the cards fall back to a short reference.
  const { data: contracts = [] } = useQuery<any[]>({
    queryKey: ["pt-contracts", ""],
    queryFn: () => contractService.getByPT(undefined),
  });
  const nameOf = new Map<string, string>(contracts.map((c: any) => [c.id as string, (c.packageName as string) ?? ""]));

  return (
    <section data-testid="pt-contract-money" aria-labelledby="pt-contract-money-title" className="space-y-2.5">
      <div>
        <h2 id="pt-contract-money-title" className="text-sm font-bold text-zinc-300">Tiền theo từng hợp đồng</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Tiền khách trả được nền tảng giữ an toàn. Mỗi hợp đồng tách riêng: phần chưa kiếm, phần đã kiếm, và phần tạm giữ.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
        </div>
      )}
      {isError && <div className="text-xs text-red-400">Không tải được tiền theo từng hợp đồng. Thử lại sau.</div>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2" data-testid="pt-wallet-summary">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3">
              <div className="text-[11px] text-zinc-500">Khả dụng</div>
              <div data-testid="pt-summary-available" data-value={data.wallet.available} className="text-sm font-bold text-zinc-100 break-words">{formatVND(num(data.wallet.available))}</div>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3">
              <div className="text-[11px] text-zinc-500">Đang tạm giữ</div>
              <div data-testid="pt-summary-held" data-value={data.wallet.held} className="text-sm font-bold text-sky-300 break-words">{formatVND(num(data.wallet.held))}</div>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3">
              <div className="text-[11px] text-zinc-500">Chưa kiếm</div>
              <div data-testid="pt-summary-pending" data-value={data.wallet.pending} className="text-sm font-bold text-zinc-100 break-words">{formatVND(num(data.wallet.pending))}</div>
            </div>
          </div>

          {num(data.totals.held) > 0 && (
            <p data-testid="pt-held-explainer" className="text-[11px] text-zinc-400 leading-snug">
              Khoản tạm giữ là tiền bạn đã kiếm, chưa rút được. Đây không phải phí và nền tảng không giữ làm doanh thu. {HOLDBACK_RELEASE_CONDITION}.
              {num(data.totals.heldDueToDispute) > 0 && ` Trong đó ${formatVND(num(data.totals.heldDueToDispute))} đang giữ vì việc chưa xử lý xong của chính hợp đồng đó.`}
            </p>
          )}

          {data.contracts.length === 0 ? (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-xs text-zinc-500">Chưa có hợp đồng nào có tiền.</div>
          ) : (
            <div className="space-y-2.5">
              {data.contracts.map((row) => (
                <ContractCard key={row.transactionId} row={row} packageName={row.contractId ? nameOf.get(row.contractId) : null} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
