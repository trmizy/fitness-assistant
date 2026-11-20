import { ActivityIndicator, Text, View } from "react-native";
import { CalendarDays, CircleAlert, CircleCheck, RefreshCw } from "lucide-react-native";

import { Button, Card } from "../../components/ui";
import { darkColors, designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import type { SyncActionId, SyncViewModel } from "./planRevision";

const TONE_BORDER: Record<SyncViewModel["tone"], string> = {
  success: "border-primary/40 bg-primary/5",
  warning: "border-warning/40 bg-warning/5",
  danger: "border-destructive/40 bg-destructive/5",
  info: "border-primary/30 bg-primary/5",
  neutral: "",
};

/**
 * "Is this plan in my schedule, and is it the latest version?" — one status card with at most one action.
 * Pure presentation of a `SyncViewModel`; the screen owns the data and the actions.
 */
export function PlanSyncCard({ model, onAction }: { model: SyncViewModel; onAction: (id: SyncActionId) => void }) {
  const accent = useWorkspaceAccent();
  const Icon = model.kind === "SYNCED" ? CircleCheck : model.kind === "UPDATE_AVAILABLE" ? RefreshCw : model.kind === "FAILED" ? CircleAlert : CalendarDays;
  const iconColor =
    model.tone === "warning" ? designTokens.warning : model.tone === "danger" ? darkColors.destructive : accent.primary;

  return (
    <Card className={`gap-3 p-4 ${TONE_BORDER[model.tone]}`}>
      <View className="flex-row items-start gap-3">
        {model.busy ? <ActivityIndicator color={accent.primary} /> : <Icon size={18} color={iconColor} style={{ marginTop: 2 }} />}
        <View className="flex-1">
          <Text className="font-body-semibold text-sm text-foreground">{model.title}</Text>
          {model.description ? <Text className="mt-1 font-body text-xs leading-5 text-muted-foreground">{model.description}</Text> : null}
        </View>
      </View>
      {model.action ? (
        <Button full size="lg" icon={model.action.id === "apply" ? RefreshCw : CalendarDays} onPress={() => onAction(model.action!.id)}>
          {model.action.label}
        </Button>
      ) : null}
    </Card>
  );
}
