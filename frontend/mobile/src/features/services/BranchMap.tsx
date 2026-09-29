import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Expand, MapPin, X } from "lucide-react-native";

import { Tappable } from "../../components/ui";

import type { BranchPin } from "./gymDirectory";

/**
 * Bản đồ CHỈ XEM các chi nhánh của một thương hiệu — cùng cách với web (`components/gym/BranchMap.tsx`):
 * Leaflet + tile OpenStreetMap, chạy trong WebView (quyết định 21/9: WebView + Leaflet — miễn phí, không
 * khoá API, và dùng lại được cho ghim kéo-thả ở Phase 12). Chi nhánh đang xem ghim xanh lớn, chi nhánh
 * khác ghim xám; chạm ghim để xem tên + địa chỉ. Chi nhánh chưa có toạ độ thì không vẽ — không đoán vị trí.
 *
 * Hai chế độ (kiểm trên emulator 21/9): WebView nuốt cử chỉ vuốt nên bản đồ trong trang cuộn KHÔNG tương
 * tác — chỉ là ô xem trước, vuốt qua thì trang cuộn bình thường; chạm vào thì mở toàn màn hình, lúc đó
 * kéo/zoom/chạm ghim thoải mái.
 *
 * Leaflet nạp từ cdnjs — bản đồ vốn đã cần Internet để tải tile.
 */
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

function html(pins: BranchPin[], currentId: string, interactive: boolean) {
  // JSON nhúng vào <script>: thoát mọi "<" để một tên chi nhánh chứa "</script>" không phá được thẻ script.
  // (U+2028/U+2029 hợp lệ trong chuỗi JS từ ES2019 — WebView Android hiện đại đều hỗ trợ.)
  const data = JSON.stringify({ pins, currentId }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET_CSS}">
<style>html,body,#m{height:100%;margin:0;background:#18181b}.leaflet-popup-content{font:13px sans-serif}</style>
</head><body><div id="m"></div>
<script src="${LEAFLET_JS}"></script>
<script>
(function(){
  var d = ${data};
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c];});}
  function dot(color,size){return L.divIcon({className:"",html:'<div style="width:'+size+'px;height:'+size+'px;border-radius:9999px;background:'+color+';border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>',iconSize:[size,size],iconAnchor:[size/2,size/2]});}
  var map = L.map("m",{zoomControl:${interactive},attributionControl:true,dragging:${interactive},touchZoom:${interactive},doubleClickZoom:${interactive},scrollWheelZoom:false,boxZoom:false,keyboard:false});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  var ll=[];
  d.pins.forEach(function(b){
    var cur = b.id===d.currentId, p=[b.latitude,b.longitude]; ll.push(p);
    L.marker(p,{icon:cur?dot("#22C55E",24):dot("#71717A",18),zIndexOffset:cur?1000:0}).addTo(map)
      .bindPopup("<strong>"+esc(b.name)+"</strong><br/>"+esc(b.address)+(cur?"<br/><em>Chi nhánh đang xem</em>":""));
  });
  if (ll.length>1) map.fitBounds(ll,{padding:[28,28],maxZoom:16}); else map.setView(ll[0],16);
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage("ready");
})();
</script></body></html>`;
}

function MapWebView({ pins, currentId, interactive }: { pins: BranchPin[]; currentId: string; interactive: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const source = useMemo(
    () => ({ html: html(pins, currentId, interactive), baseUrl: "https://gymini.app/" }),
    [pins, currentId, interactive],
  );
  return (
    <View className="flex-1">
      <WebView
        source={source}
        originWhitelist={["*"]}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        // Link trong bản đồ (vd ghi công OpenStreetMap) mở ra trình duyệt ngoài, không kéo WebView đi mất.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url.startsWith("https://gymini.app") || req.url.startsWith("about:") || req.url.startsWith("data:")) return true;
          void Linking.openURL(req.url);
          return false;
        }}
        onMessage={(e) => e.nativeEvent.data === "ready" && setState("ready")}
        onError={() => setState("error")}
        onHttpError={() => setState("error")}
        style={{ backgroundColor: "transparent" }}
      />
      {state !== "ready" ? (
        <View className="absolute inset-0 items-center justify-center gap-2 bg-card">
          {state === "loading" ? (
            <ActivityIndicator />
          ) : (
            <>
              <MapPin size={20} color="#8b9299" />
              <Text className="font-body text-xs text-muted-foreground">Không tải được bản đồ lúc này.</Text>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function BranchMap({ branches, currentId }: { branches: BranchPin[]; currentId: string }) {
  const insets = useSafeAreaInsets();
  const pins = useMemo(() => branches.filter((b) => b.latitude != null && b.longitude != null), [branches]);
  const [open, setOpen] = useState(false);

  if (pins.length === 0) {
    return (
      <View className="items-center rounded-xl border border-border p-4">
        <Text className="font-body text-xs text-muted-foreground">Chi nhánh chưa cập nhật vị trí trên bản đồ.</Text>
      </View>
    );
  }

  return (
    <>
      <View className="h-56 overflow-hidden rounded-xl border border-border bg-card">
        {/* Ô xem trước: WebView không nhận chạm, lớp phủ bắt chạm để mở toàn màn hình, vuốt thì trang cuộn. */}
        <View className="flex-1" pointerEvents="none">
          <MapWebView pins={pins} currentId={currentId} interactive={false} />
        </View>
        <Tappable className="absolute inset-0" onPress={() => setOpen(true)} accessibilityLabel="Mở bản đồ chi nhánh">
          <View className="absolute right-2 top-2 flex-row items-center gap-1 rounded-md bg-black/60 px-2 py-1">
            <Expand size={12} color="#ffffff" />
            <Text className="font-body text-[11px] text-white">Chạm để mở bản đồ</Text>
          </View>
        </Tappable>
      </View>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text className="font-display text-base text-foreground">Bản đồ chi nhánh</Text>
            <Tappable
              onPress={() => setOpen(false)}
              accessibilityLabel="Đóng bản đồ"
              className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
            >
              <X size={18} color="#8b9299" />
            </Tappable>
          </View>
          <MapWebView pins={pins} currentId={currentId} interactive />
        </View>
      </Modal>
    </>
  );
}
