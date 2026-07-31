import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  Screen,
  Text,
  Button,
  Card,
  Input,
  Badge,
  Skeleton,
  SkeletonCard,
  EmptyState,
  colors,
  spacing,
} from "../../src/ui";

// Demo screen rendering every base UI component — not part of the real app
// navigation, just a visual smoke test for the design system (P2 DoD).
export default function DevUiScreen() {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Screen
      scroll
      onRefresh={() => {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 800);
      }}
      refreshing={refreshing}
    >
      <Text variant="heading">Design system demo</Text>

      <Section title="Text variants">
        <Text variant="heading">Heading</Text>
        <Text variant="subheading">Subheading</Text>
        <Text variant="body">Body text</Text>
        <Text variant="bodyStrong">Body strong</Text>
        <Text variant="caption">Caption text</Text>
        <Text variant="small">Small / label text</Text>
      </Section>

      <Section title="Buttons">
        <View style={{ gap: spacing.sm }}>
          <Button label="Primary" variant="primary" onPress={() => {}} />
          <Button label="Secondary" variant="secondary" onPress={() => {}} />
          <Button label="Ghost" variant="ghost" onPress={() => {}} />
          <Button label="Danger" variant="danger" onPress={() => {}} />
          <Button label="Loading" loading={loading} onPress={() => setLoading((v) => !v)} />
          <Button label="Disabled" disabled onPress={() => {}} />
        </View>
      </Section>

      <Section title="Card">
        <Card>
          <Text variant="subheading">Card title</Text>
          <Text variant="caption">A basic card with border + radius.</Text>
        </Card>
      </Section>

      <Section title="Input">
        <Input label="Email" placeholder="ban@vidu.com" keyboardType="email-address" />
        <Input label="Mật khẩu" placeholder="••••••••" secureTextEntry error="Tối thiểu 8 ký tự" />
      </Section>

      <Section title="Badge">
        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
          <Badge label="Neutral" tone="neutral" />
          <Badge label="Success" tone="success" />
          <Badge label="Warning" tone="warning" />
          <Badge label="Danger" tone="danger" />
          <Badge label="Info" tone="info" />
          <Badge label="Accent" tone="accent" />
        </View>
      </Section>

      <Section title="Skeleton">
        <SkeletonCard lines={3} />
        <Skeleton width={120} height={20} />
      </Section>

      <Section title="EmptyState">
        <Card>
          <EmptyState
            icon={(p) => <Feather name="inbox" {...p} />}
            title="Chưa có dữ liệu"
            description="Đây là ví dụ EmptyState với icon và action."
            actionLabel="Thử lại"
            onAction={() => {}}
          />
        </Card>
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="small" style={{ color: colors.textMuted, textTransform: "uppercase" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}
