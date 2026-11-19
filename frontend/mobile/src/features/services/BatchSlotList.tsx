import { Text, View } from "react-native";
import { X } from "lucide-react-native";

import { Tappable } from "../../components/ui";
import { designTokens } from "../../theme/colors";
import { slotKey, slotLabel, type PickedSlot } from "./batchBooking";

/**
 * The slots a client has lined up for one "đặt nhiều buổi" request: one row per slot, a remove button (40px target)
 * and - after the server refused the batch - the reason under the slot it concerns.
 */
export function BatchSlotList({
  slots,
  errors,
  onRemove,
  disabled,
}: {
  slots: PickedSlot[];
  /** Reason per slot, keyed by `slotKey` (batchBooking.readBatchRejection). */
  errors?: Record<string, string>;
  onRemove: (slot: PickedSlot) => void;
  disabled?: boolean;
}) {
  if (slots.length === 0) return null;
  return (
    <View className="gap-2">
      {slots.map((slot) => {
        const key = slotKey(slot);
        const error = errors?.[key];
        return (
          <View
            key={key}
            testID={`batch-slot-${key}`}
            className={`rounded-xl border px-3 py-1 ${error ? "border-destructive" : "border-border bg-panel"}`}
          >
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 font-body-medium text-sm text-foreground">{slotLabel(slot)}</Text>
              <Tappable
                className="h-10 w-10 items-center justify-center"
                disabled={disabled}
                accessibilityLabel={`Bỏ khung giờ ${slotLabel(slot)}`}
                onPress={() => onRemove(slot)}
              >
                <X size={16} color={designTokens.mutedForeground} />
              </Tappable>
            </View>
            {error ? <Text className="pb-2 font-body text-xs text-destructive">{error}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
