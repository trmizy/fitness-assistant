import { ActivityIndicator, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Clock, Lock } from "lucide-react-native";

import { Badge, Card } from "../../components/ui";
import { contractService } from "../../services/api";
import { designTokens } from "../../theme/colors";
import { formatVND } from "../../utils/currency";
import {
  HOLDBACK_RELEASE_CONDITION,
  contractTitle,
  earnedPercent,
  holdbackBadge,
  holdbackNote,
  num,
  type PtWalletContractRow,
} from "./ptWalletContracts";
import { fetchPtWalletContracts } from "./ptWalletApi";

const TONE = { info: "info", warn: "warning", ok: "success" } as const;

function Figure({ label, value, hint, testID }: { label: string; value: string; hint?: string; testID: string }) {
  return (
    <View className="w-1/2 pb-3 pr-3" testID={testID}>
      <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
      <Text className="font-body-semibold text-sm text-foreground">{formatVND(num(value))}</Text>
      {hint ? <Text className="font-body text-[10px] text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}

function ContractCard({ row, packageName }: { row: PtWalletContractRow; packageName?: string | null }) {
  const note = holdbackNote(row);
  const badge = holdbackBadge(row);
  const pct = earnedPercent(row);
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text className="font-body-semibold text-sm text-foreground">{contractTitle(row, packageName)}</Text>
          <Text className="font-body text-[11px] text-muted-foreground">Giá trị hợp đồng {formatVND(num(row.contractValue))}</Text>
        </View>
        {badge ? <Badge tone={TONE[badge.tone]}>{badge.label}</Badge> : null}
      </View>

      <View>
        <View className="h-1.5 overflow-hidden rounded-full bg-panel" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
          <View className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </View>
        <Text className="mt-1 font-body text-[11px] text-muted-foreground">Đã kiếm {pct}% thu nhập dự kiến của hợp đồng này</Text>
      </View>

      <View className="flex-row flex-wrap">
        <Figure testID="pt-contract-expected" label="Thu nhập dự kiến của bạn" value={row.expectedIncome} hint="Nếu bạn dạy đủ các buổi" />
        <Figure testID="pt-contract-pending" label="Chưa kiếm" value={row.pending} hint="Các buổi chưa diễn ra" />
        <Figure testID="pt-contract-earned" label="Đã kiếm" value={row.earned} hint="Đã vào số dư + đang tạm giữ" />
        <Figure testID="pt-contract-held" label="Đang tạm giữ" value={row.held} hint="Của bạn, chưa rút được" />
        <Figure testID="pt-contract-available" label="Đã chuyển vào số dư" value={row.availableFromContract} hint="Rút được" />
        {num(row.compensationPaid) > 0 ? (
          <Figure testID="pt-contract-compensation" label="Đã dùng để bồi thường khách" value={row.compensationPaid} hint="Hợp đồng kết thúc vì lỗi của PT" />
        ) : null}
      </View>

      {note ? (
        <View className="flex-row items-start gap-1.5" testID="pt-contract-holdback-note">
          {row.release.heldDueToDispute ? <Clock size={13} color={designTokens.warning} /> : <Lock size={13} color={designTokens.mutedForeground} />}
          <Text className="flex-1 font-body text-[11px] leading-4 text-muted-foreground">{note}</Text>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * FH-9: the PT's money per contract (read only, from the ledger). What is not earned yet, what is earned, what is held back (earned,
 * not withdrawable) and the CONDITION under which it comes back - never a fixed date.
 */
export function PtContractMoney({ uid }: { uid: string }) {
  const q = useQuery({ queryKey: ["pt-wallet-contracts", uid], queryFn: fetchPtWalletContracts });
  // Package names make the cards readable; if this lookup fails the cards fall back to a short reference.
  const names = useQuery({ queryKey: ["pt-contracts-names", uid], queryFn: () => contractService.getByPT(undefined) });
  const nameOf: Record<string, string> = Object.fromEntries((Array.isArray(names.data) ? names.data : []).map((c: any) => [c.id, c.packageName ?? ""]));
  const data = q.data;
  return (
    <View className="gap-3" testID="pt-contract-money">
      <View className="px-1">
        <Text className="font-display text-lg text-foreground">Tiền theo từng hợp đồng</Text>
        <Text className="font-body text-xs text-muted-foreground">
          Tiền khách trả được nền tảng giữ an toàn. Mỗi hợp đồng tách riêng: phần chưa kiếm, đã kiếm và tạm giữ.
        </Text>
      </View>
      {q.isLoading ? <ActivityIndicator /> : null}
      {q.isError ? <Text className="font-body text-sm text-destructive">Không tải được tiền theo từng hợp đồng. Kéo xuống để thử lại.</Text> : null}
      {data && num(data.totals.held) > 0 ? (
        <Text className="px-1 font-body text-xs leading-4 text-muted-foreground" testID="pt-held-explainer">
          Khoản tạm giữ là tiền bạn đã kiếm, chưa rút được. Đây không phải phí và nền tảng không giữ làm doanh thu. {HOLDBACK_RELEASE_CONDITION}.
          {num(data.totals.heldDueToDispute) > 0 ? ` Trong đó ${formatVND(num(data.totals.heldDueToDispute))} đang giữ vì việc chưa xử lý xong của chính hợp đồng đó.` : ""}
        </Text>
      ) : null}
      {data && data.contracts.length === 0 ? <Text className="px-1 font-body text-xs text-muted-foreground">Chưa có hợp đồng nào có tiền.</Text> : null}
      {data?.contracts.map((row) => (
        <ContractCard key={row.transactionId} row={row} packageName={row.contractId ? nameOf[row.contractId] : null} />
      ))}
    </View>
  );
}
