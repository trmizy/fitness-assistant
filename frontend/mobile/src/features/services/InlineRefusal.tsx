import { Text, View } from "react-native";

/**
 * A server refusal written INSIDE a bottom sheet. A sheet is a native Modal window, and the app's toast is drawn in the root
 * window underneath it - so a toast raised from a sheet is never seen and the button just looks dead. Keep the toast if you like,
 * but this is the part that is guaranteed to be read. Renders nothing for an empty message.
 */
export function InlineRefusal({ message, testID }: { message: string | null | undefined; testID?: string }) {
  if (!message) return null;
  return (
    <View
      className="rounded-xl border border-destructive/40 bg-destructive/10 p-3"
      accessibilityRole="alert"
      testID={testID}
    >
      <Text className="font-body-medium text-sm text-foreground">{message}</Text>
    </View>
  );
}
