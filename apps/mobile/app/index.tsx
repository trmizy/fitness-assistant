import { StyleSheet, Text, View } from "react-native";
import type { User } from "@gym-coach/shared";

// P1 verification: importing a real type from the workspace shared package
// and actually using it confirms Metro/pnpm workspace resolution works
// end-to-end (not just a type-only no-op that skips module resolution).
const resolveCheck: Pick<User, "id" | "email"> = {
  id: "resolve-check",
  email: "@gym-coach/shared resolved ok",
};

export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gym Coach</Text>
      <Text style={styles.subtitle}>Hello — Expo scaffold sẵn sàng (P1)</Text>
      <Text style={styles.debug}>{resolveCheck.email}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: "#a1a1aa",
    fontSize: 14,
  },
  debug: {
    color: "#52525b",
    fontSize: 11,
    marginTop: 16,
  },
});
