import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { Expand, LocateFixed, MapPin, X } from "lucide-react-native";

import { Button, Tappable, useToast } from "../../components/ui";
import { darkColors, designTokens } from "../../theme/colors";

/**
 * Ghim vị trí chi nhánh trên bản đồ — bản kéo-thả của `BranchMap` (Phase 7, quyết định 21/9:
 * WebView + Leaflet + tile OpenStreetMap, không khoá API, không thư viện bản đồ native).
 *
 * Hai chế độ, đúng lý do đã ghi ở `BranchMap`: WebView nuốt cử chỉ vuốt, nên ô trong trang chỉ là
 * xem trước (vuốt qua thì trang cuộn); chạm vào mới mở toàn màn hình để kéo ghim.
 *
 * Toạ độ chỉ đi ra ngoài khi người dùng bấm "Dùng vị trí này" — kéo thử rồi đóng bằng X thì ghim cũ
 * còn nguyên. Chưa có ghim thì mở giữa bản đồ Việt Nam và KHÔNG tự đặt toạ độ: một ghim mặc định ở
 * giữa nước là toạ độ bịa, tệ hơn là không có.
 */
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

/** Giữa Việt Nam, chỉ dùng làm khung nhìn ban đầu khi chưa có ghim. */
const VN_CENTER = { lat: 16.047079, lng: 108.20623, zoom: 5 };

function html(lat: number | null, lng: number | null, interactive: boolean) {
  const start = lat != null && lng != null ? { lat, lng, zoom: 16 } : VN_CENTER;
  const data = JSON.stringify({ start, hasPin: lat != null && lng != null }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET_CSS}">
<style>html,body,#m{height:100%;margin:0;background:#18181b}</style>
</head><body><div id="m"></div>
<script src="${LEAFLET_JS}"></script>
<script>
(function(){
  var d = ${data};
  var map = L.map("m",{zoomControl:${interactive},attributionControl:true,dragging:${interactive},touchZoom:${interactive},doubleClickZoom:${interactive},scrollWheelZoom:false,boxZoom:false,keyboard:false});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  map.setView([d.start.lat,d.start.lng],d.start.zoom);
  var icon = L.divIcon({className:"",html:'<div style="width:26px;height:26px;border-radius:9999px;background:#22C55E;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.6)"></div>',iconSize:[26,26],iconAnchor:[13,13]});
  var marker = null;
  function send(){ if(!marker||!window.ReactNativeWebView) return; var p=marker.getLatLng();
    window.ReactNativeWebView.postMessage(JSON.stringify({type:"pin",latitude:p.lat,longitude:p.lng})); }
  function place(latlng){
    if (marker) { marker.setLatLng(latlng); }
    else { marker = L.marker(latlng,{icon:icon,draggable:${interactive}}).addTo(map); marker.on("dragend",send); }
    send();
  }
  if (d.hasPin) place([d.start.lat,d.start.lng]);
  ${interactive ? 'map.on("click",function(e){place(e.latlng);});' : ""}
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:"ready"}));
})();
</script></body></html>`;
}

function MapView({
  lat,
  lng,
  interactive,
  onPin,
}: {
  lat: number | null;
  lng: number | null;
  interactive: boolean;
  onPin?: (p: { latitude: number; longitude: number }) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // Toạ độ ban đầu được nướng thẳng vào HTML, nên đổi ghim = nạp lại trang. Kéo ghim BÊN TRONG
  // WebView không đi qua đây (toạ độ mới chỉ nằm ở state cha), nên không có chuyện trang nạp lại
  // giữa lúc kéo và ghim nhảy về chỗ cũ.
  const source = useMemo(
    () => ({ html: html(lat, lng, interactive), baseUrl: "https://gymini.app/" }),
    [lat, lng, interactive],
  );
  return (
    <View className="flex-1">
      <WebView
        source={source}
        originWhitelist={["*"]}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) => {
          if (req.url.startsWith("https://gymini.app") || req.url.startsWith("about:") || req.url.startsWith("data:")) {
            return true;
          }
          return false;
        }}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg?.type === "ready") setState("ready");
            if (msg?.type === "pin" && Number.isFinite(msg.latitude) && Number.isFinite(msg.longitude)) {
              onPin?.({ latitude: msg.latitude, longitude: msg.longitude });
            }
          } catch {
            // Một thông điệp lạ không đáng làm sập màn hình đang nhập liệu.
          }
        }}
        onError={() => setState("error")}
        onHttpError={() => setState("error")}
        style={{ backgroundColor: darkColors.panel }}
      />
      {state !== "ready" ? (
        <View className="absolute inset-0 items-center justify-center bg-panel">
          {state === "loading" ? (
            <ActivityIndicator color={darkColors.primary} />
          ) : (
            <Text className="px-6 text-center font-body text-xs text-muted-foreground">
              Không tải được bản đồ. Bạn vẫn tạo được chi nhánh — có thể ghim lại sau.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function MapPinPicker({
  latitude,
  longitude,
  onChange,
  hint,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (p: { latitude: number; longitude: number }) => void;
  hint?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  /**
   * Web's "Dùng vị trí hiện tại" (`GymLocationFields`), as a device permission rather than a
   * browser prompt. Counts as placing the pin by hand — the owner is standing in the gym, so the
   * address lookup must not overwrite it afterwards; `onChange` is what marks it manual.
   */
  const pickCurrentLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        toast.show("Chưa được cấp quyền vị trí — hãy bật trong Cài đặt, hoặc ghim tay trên bản đồ", "danger");
        return;
      }
      // `getCurrentPositionAsync` không nhận tuỳ chọn timeout và có thể chờ mãi khi máy không bắt
      // được định vị (đã thấy trên emulator: nút kẹt ở "Đang lấy vị trí…" không bao giờ thoát).
      // Chạy đua với một hạn chờ 10 giây — đúng bằng `timeout: 10_000` mà bản web đang dùng.
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]).catch(() => null);
      if (pos) {
        onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        toast.show("Đã lấy vị trí hiện tại", "success");
        return;
      }

      // Trong nhà — đúng lúc chủ gym đứng trong phòng gym mà bấm nút này — máy thường không bắt
      // được định vị MỚI. Bản định vị gần nhất còn hơn là không có gì, nhưng nó có thể cũ và lệch,
      // nên phải nói rõ là gần đúng chứ không lặng lẽ ghim như thể vừa đo.
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
      if (!last) {
        toast.show("Chưa bắt được định vị — ra chỗ thoáng rồi thử lại, hoặc ghim tay", "danger");
        return;
      }
      onChange({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      toast.show("Chỉ lấy được vị trí gần đúng — hãy kiểm lại ghim trên bản đồ", "danger");
    } catch {
      toast.show("Không lấy được vị trí lúc này — bạn vẫn ghim tay được", "danger");
    } finally {
      setLocating(false);
    }
  };
  // Ghim đang kéo trong màn toàn màn hình, chưa cam kết ra ngoài.
  const [draft, setDraft] = useState<{ latitude: number; longitude: number } | null>(null);

  const has = latitude != null && longitude != null;
  const shown = draft ?? (has ? { latitude: latitude!, longitude: longitude! } : null);

  return (
    <View className="gap-2">
      <Tappable
        accessibilityLabel="Mở bản đồ để ghim vị trí"
        onPress={() => {
          setDraft(null);
          setOpen(true);
        }}
        className="h-40 overflow-hidden rounded-2xl border border-border"
      >
        {/* Chỉ vẽ ô xem trước khi màn ghim đang đóng, và dựng lại sau mỗi lần đóng: Android thu hồi
            bề mặt WebView bên dưới một Modal, đóng ra thì ô xem trước trắng trơn. Khoá `key` cũng
            khiến ghim tự động hiện ngay ở ô này. */}
        {open ? (
          <View className="flex-1 bg-panel" />
        ) : (
          <MapView key={`${latitude ?? "-"},${longitude ?? "-"}`} lat={latitude} lng={longitude} interactive={false} />
        )}
        <View className="absolute bottom-2 right-2 flex-row items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1.5">
          <Expand size={13} color={designTokens.mutedForeground} />
          <Text className="font-body-semibold text-[11px] text-muted-foreground">
            {has ? "Sửa ghim" : "Ghim vị trí"}
          </Text>
        </View>
      </Tappable>

      <Button
        variant="secondary"
        size="sm"
        icon={LocateFixed}
        disabled={locating}
        onPress={() => void pickCurrentLocation()}
      >
        {locating ? "Đang lấy vị trí…" : "Dùng vị trí hiện tại"}
      </Button>

      {hint ? <Text className="font-body text-[11px] text-muted-foreground">{hint}</Text> : null}
      {has ? (
        <Text className="font-body text-[11px] text-muted-foreground">
          {latitude!.toFixed(5)}, {longitude!.toFixed(5)}
        </Text>
      ) : (
        <Text className="font-body text-[11px] text-muted-foreground">
          Chưa ghim vị trí. Nhập đủ địa chỉ thì bản đồ tự ghim, hoặc chạm để ghim tay.
        </Text>
      )}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center gap-3 px-4 py-3">
            <Tappable accessibilityLabel="Đóng bản đồ" onPress={() => setOpen(false)} className="p-1">
              <X size={20} color={darkColors.foreground} />
            </Tappable>
            <View className="flex-1">
              <Text className="font-display text-base text-foreground">Ghim vị trí chi nhánh</Text>
              <Text className="font-body text-[11px] text-muted-foreground">
                Chạm vào bản đồ hoặc kéo ghim xanh tới đúng cửa phòng gym.
              </Text>
            </View>
          </View>
          {open ? <MapView lat={latitude} lng={longitude} interactive onPin={setDraft} /> : null}
          <View
            className="gap-2 border-t border-border bg-background px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <View className="flex-row items-center gap-2">
              <MapPin size={14} color={designTokens.mutedForeground} />
              <Text className="font-body text-xs text-muted-foreground">
                {shown ? `${shown.latitude.toFixed(5)}, ${shown.longitude.toFixed(5)}` : "Chưa chọn điểm nào"}
              </Text>
            </View>
            <Button
              disabled={!draft}
              onPress={() => {
                if (draft) onChange(draft);
                setOpen(false);
              }}
            >
              Dùng vị trí này
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}
