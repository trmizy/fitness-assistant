import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react-native";

import { Tappable } from "../../components/ui";
import { absolutePhotoUrl } from "../../services/api";
import { PHOTO_CATEGORY_LABEL, type GymPhoto } from "./gymDirectory";

/**
 * CL-09 (vá 21/9 theo web `GymPhotoGallery.tsx`): ảnh lớn hiện TRỌN ảnh (contain, không cắt), nút ‹ ›
 * ngay hai bên ảnh lớn để chuyển ảnh, dải ảnh nhỏ để chọn nhanh, chạm ảnh lớn để xem toàn màn hình.
 *
 * Ảnh là link ký tạm của bucket riêng tư (gym-service ký theo đúng địa chỉ app đang gọi — IP LAN,
 * 10.0.2.2 của emulator hay tunnel — và gateway chuyển tiếp sang kho tệp), nên không cần header gì thêm.
 */
export function GymPhotoGallery({ photos, title }: { photos: GymPhoto[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const n = photos.length;
  if (n === 0) return null;

  // Danh sách ảnh đổi (tải lại) thì chỉ số cũ có thể vượt — kẹp lúc render thay vì đặt lại bằng effect.
  const safeIndex = Math.min(index, n - 1);
  const cur = photos[safeIndex];
  const go = (d: number) => setIndex((safeIndex + d + n) % n);
  const label = cur.category ? PHOTO_CATEGORY_LABEL[cur.category] ?? null : null;

  return (
    <View className="gap-2">
      <View className="overflow-hidden rounded-2xl border border-border bg-black" style={{ aspectRatio: 4 / 3 }}>
        <Tappable className="flex-1" onPress={() => setFull(true)} accessibilityLabel="Xem ảnh toàn màn hình">
          <Image source={{ uri: absolutePhotoUrl(cur.url) ?? undefined }} contentFit="contain" style={{ flex: 1 }} transition={150} accessibilityLabel={`${title} — ${label ?? `ảnh ${safeIndex + 1}`}`} />
        </Tappable>
        {n > 1 ? (
          <>
            <NavButton side="left" onPress={() => go(-1)} />
            <NavButton side="right" onPress={() => go(1)} />
          </>
        ) : null}
        {label ? (
          <View className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5">
            <Text className="font-body text-[11px] text-white">{label}</Text>
          </View>
        ) : null}
        <View className="absolute bottom-2 right-2 flex-row items-center gap-1 rounded-md bg-black/60 px-2 py-0.5">
          <Text className="font-body text-[11px] text-white">{`${safeIndex + 1}/${n}`}</Text>
          <Maximize2 size={11} color="#ffffff" />
        </View>
      </View>

      {n > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {photos.map((p, i) => (
            <Tappable
              key={p.id}
              onPress={() => setIndex(i)}
              accessibilityLabel={`Chọn ảnh ${i + 1}`}
              className={`h-14 w-20 overflow-hidden rounded-lg border-2 ${i === safeIndex ? "border-primary" : "border-transparent"}`}
            >
              <Image source={{ uri: absolutePhotoUrl(p.url) ?? undefined }} contentFit="cover" style={{ flex: 1, opacity: i === safeIndex ? 1 : 0.7 }} />
            </Tappable>
          ))}
        </ScrollView>
      ) : null}

      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <View className="flex-1 items-center justify-center bg-black/95">
          <Image source={{ uri: absolutePhotoUrl(cur.url) ?? undefined }} contentFit="contain" style={{ width: "100%", height: "80%" }} />
          <Text className="mt-2 font-body text-xs text-white/70">
            {label ? `${label} · ` : ""}
            {`${safeIndex + 1}/${n}`}
          </Text>
          {n > 1 ? (
            <>
              <NavButton side="left" onPress={() => go(-1)} />
              <NavButton side="right" onPress={() => go(1)} />
            </>
          ) : null}
          <Tappable
            onPress={() => setFull(false)}
            accessibilityLabel="Đóng"
            className="absolute right-4 top-12 h-10 w-10 items-center justify-center rounded-full bg-white/15"
          >
            <X size={20} color="#ffffff" />
          </Tappable>
        </View>
      </Modal>
    </View>
  );
}

function NavButton({ side, onPress }: { side: "left" | "right"; onPress: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Tappable
      onPress={onPress}
      accessibilityLabel={side === "left" ? "Ảnh trước" : "Ảnh sau"}
      className={`absolute top-1/2 h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 ${side === "left" ? "left-2" : "right-2"}`}
    >
      <Icon size={20} color="#ffffff" />
    </Tappable>
  );
}
