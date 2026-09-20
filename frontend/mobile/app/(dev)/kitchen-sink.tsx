import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import {
  Activity,
  Bell,
  Dumbbell,
  Mail,
  Plus,
  Trash2,
} from "lucide-react-native";

import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  CountUp,
  EmptyState,
  Input,
  ProgressRing,
  ScreenHeader,
  SectionHeader,
  Segmented,
  Skeleton,
  SkeletonLines,
  Stagger,
  SwipeRow,
  Tappable,
  useToast,
} from "../../src/components/ui";
import {
  WorkspaceProvider,
  useWorkspaceAccent,
  workspaceVars,
  type Workspace,
} from "../../src/theme/workspace";

/**
 * Design-system kitchen sink — every component in every state, so it can be held side by side with
 * `D:\New Frontend` and compared directly. Deliberately NOT wired into any navigation: it is
 * reached by typing the route, and it must never appear in the shipped tab bar.
 *
 * The workspace switcher at the top is the most valuable control here — it re-themes the whole
 * screen through the accent variables, which is the fastest way to catch a component that
 * hardcoded green instead of using `primary`.
 */
export default function KitchenSink() {
  const [workspace, setWorkspace] = useState<Workspace>("client");

  return (
    // Two halves of the same switch: the style carries the CSS variables every `primary`/chart
    // class resolves through, and the provider tells the few components that need a raw hex
    // (SVG strokes, Lucide icons) which accent is active.
    <WorkspaceProvider value={workspace}>
      <View className="flex-1 bg-background" style={workspaceVars[workspace]}>
        <ScreenHeader title="Kitchen sink" onBack={() => router.back()} />
        <KitchenSinkBody workspace={workspace} onWorkspaceChange={setWorkspace} />
      </View>
    </WorkspaceProvider>
  );
}

const workspaceLabels: Record<string, Workspace> = {
  Client: "client",
  PT: "pt",
  Gym: "gym",
  Admin: "admin",
};

function KitchenSinkBody({
  workspace,
  onWorkspaceChange,
}: {
  workspace: Workspace;
  onWorkspaceChange: (workspace: Workspace) => void;
}) {
  const toast = useToast();
  const accent = useWorkspaceAccent();
  const [segment, setSegment] = useState("Tuần");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [withError, setWithError] = useState("sai@dinh-dang");

  const currentLabel =
    Object.keys(workspaceLabels).find((key) => workspaceLabels[key] === workspace) ?? "Client";

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-7 p-5 pb-16">
      <Section title="Workspace accent">
        <Text className="mb-3 text-sm font-body text-muted-foreground">
          Đổi workspace để kiểm tra mọi component có bám theo màu chủ đạo không.
        </Text>
        <Segmented
          options={Object.keys(workspaceLabels)}
          value={currentLabel}
          onChange={(label) => onWorkspaceChange(workspaceLabels[label])}
        />
      </Section>

      <Section title="Button">
        <View className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            <Button onPress={() => toast.show("Primary")}>Primary</Button>
            <Button variant="secondary" onPress={() => toast.show("Secondary")}>
              Secondary
            </Button>
            <Button variant="ghost" onPress={() => toast.show("Ghost")}>
              Ghost
            </Button>
            <Button variant="destructive" onPress={() => toast.show("Xoá rồi", "danger")}>
              Destructive
            </Button>
          </View>
          <View className="flex-row flex-wrap items-center gap-2">
            <Button size="sm" icon={Plus}>
              Small
            </Button>
            <Button size="md" icon={Plus}>
              Medium
            </Button>
            <Button size="lg" icon={Plus}>
              Large
            </Button>
          </View>
          <Button full icon={Dumbbell} onPress={() => toast.show("Bắt đầu buổi tập")}>
            Full width
          </Button>
          <Button full disabled>
            Disabled
          </Button>
        </View>
      </Section>

      <Section title="Card / Tappable">
        <View className="gap-3">
          <Card className="p-4">
            <Text className="font-display text-base text-foreground">Card tĩnh</Text>
            <Text className="mt-1 text-sm font-body text-muted-foreground">
              Không có onPress nên không co lại khi chạm.
            </Text>
          </Card>
          <Card className="p-4" onPress={() => toast.show("Đã chạm card")}>
            <Text className="font-display text-base text-foreground">Card bấm được</Text>
            <Text className="mt-1 text-sm font-body text-muted-foreground">
              Co lại 0.97 + haptic nhẹ.
            </Text>
          </Card>
          <Tappable
            className="items-center rounded-2xl border border-dashed border-border py-6"
            onPress={() => toast.show("Tappable")}
          >
            <Text className="text-sm font-body-medium text-muted-foreground">
              Tappable bọc bất kỳ thứ gì
            </Text>
          </Tappable>
        </View>
      </Section>

      <Section title="Badge">
        <View className="flex-row flex-wrap gap-2">
          <Badge tone="success">Hoàn thành</Badge>
          <Badge tone="warning">Chờ duyệt</Badge>
          <Badge tone="danger">Từ chối</Badge>
          <Badge tone="info">Mới</Badge>
          <Badge>Nháp</Badge>
        </View>
      </Section>

      <Section title="Avatar">
        <View className="flex-row items-end gap-3">
          <Avatar name="Nguyễn Văn A" size={32} />
          <Avatar name="Trần Thị B" size={44} />
          <Avatar name="Lê Văn C" size={56} />
          <Avatar
            name="Có ảnh"
            size={56}
            uri="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=200&q=60"
          />
        </View>
      </Section>

      <Section title="Input">
        <View className="gap-3">
          <Input
            label="Email"
            icon={Mail}
            placeholder="ban@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            label="Có lỗi"
            icon={Mail}
            placeholder="ban@email.com"
            value={withError}
            onChangeText={setWithError}
            error="Email không hợp lệ"
          />
          <Input placeholder="Không nhãn, không icon" />
        </View>
      </Section>

      <Section title="Segmented">
        <Segmented options={["Tuần", "Tháng", "Năm"]} value={segment} onChange={setSegment} />
        <Text className="mt-2 text-sm font-body text-muted-foreground">
          Đang chọn: {segment}
        </Text>
      </Section>

      <Section title="CountUp / ProgressRing">
        <View className="flex-row items-center gap-6">
          <ProgressRing progress={0.72}>
            <CountUp
              to={72}
              suffix="%"
              className="font-display text-xl text-foreground"
            />
          </ProgressRing>
          <View className="gap-1">
            <CountUp
              to={12480}
              className="font-display text-2xl text-foreground"
            />
            <Text className="text-sm font-body text-muted-foreground">bước hôm nay</Text>
            <CountUp
              to={68.4}
              decimals={1}
              suffix=" kg"
              className="font-display text-xl text-primary"
            />
          </View>
        </View>
      </Section>

      <Section title="Stagger">
        <Stagger className="gap-2">
          {[1, 2, 3, 4].map((n) => (
            <Card key={n} className="flex-row items-center gap-3 p-3">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
                <Activity size={18} color={accent.primary} />
              </View>
              <Text className="font-body-medium text-foreground">Mục thứ {n}</Text>
            </Card>
          ))}
        </Stagger>
      </Section>

      <Section title="SwipeRow">
        <Text className="mb-2 text-sm font-body text-muted-foreground">
          Vuốt sang trái để lộ hành động.
        </Text>
        <SwipeRow actionLabel="Xoá" actionIcon={Trash2} onAction={() => toast.show("Đã xoá", "danger")}>
          <Card className="flex-row items-center gap-3 p-4">
            <Avatar name="Phạm D" size={36} />
            <View className="flex-1">
              <Text className="font-body-medium text-foreground">Buổi tập ngực</Text>
              <Text className="text-sm font-body text-muted-foreground">45 phút · 6 bài</Text>
            </View>
          </Card>
        </SwipeRow>
      </Section>

      <Section title="BottomSheet">
        <Button variant="secondary" full onPress={() => setSheetOpen(true)}>
          Mở bottom sheet
        </Button>
      </Section>

      <Section title="Toast">
        <View className="flex-row gap-2">
          <Button size="sm" onPress={() => toast.show("Đã lưu thay đổi")}>
            Success
          </Button>
          <Button size="sm" variant="destructive" onPress={() => toast.show("Không thể lưu", "danger")}>
            Danger
          </Button>
        </View>
      </Section>

      <Section title="Skeleton">
        <View className="gap-3">
          <Card className="flex-row items-center gap-3 p-4">
            <Skeleton className="h-11 w-11 rounded-full" />
            <View className="flex-1">
              <SkeletonLines lines={2} />
            </View>
          </Card>
          <Skeleton className="h-24 rounded-2xl" />
        </View>
      </Section>

      <Section title="EmptyState">
        <Card>
          <EmptyState
            icon={Bell}
            title="Chưa có thông báo"
            description="Khi có hoạt động mới, chúng sẽ xuất hiện ở đây."
            actionLabel="Làm mới"
            onAction={() => toast.show("Đã làm mới")}
          />
        </Card>
      </Section>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Bottom sheet">
        <Text className="mb-4 text-sm font-body text-muted-foreground">
          Kéo xuống quá 120px rồi thả để đóng — sẽ có haptic ngay lúc vượt ngưỡng. Nút back của
          Android cũng đóng sheet thay vì thoát màn hình.
        </Text>
        <Button full onPress={() => setSheetOpen(false)}>
          Đóng
        </Button>
      </BottomSheet>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}
