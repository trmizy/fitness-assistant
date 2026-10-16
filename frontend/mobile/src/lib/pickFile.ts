import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { UploadFile } from "../services/api";

export type PickedFile = UploadFile & { isImage: boolean };

// Same cap the server's multer applies to PT documents (10 MB).
const MAX_BYTES = 10 * 1024 * 1024;

function extType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

/** One picked image → an upload descriptor declaring the file's REAL type. */
function assetToFile(a: ImagePicker.ImagePickerAsset, maxBytes: number): PickedFile {
  if (a.fileSize && a.fileSize > maxBytes) throw new Error(`Ảnh quá lớn (tối đa ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  // Khai đúng loại byte THẬT của tệp. Trước đây giả định picker luôn nén lại thành JPEG (quality < 1) —
  // sai trên Android: bộ chọn ảnh hệ thống trả nguyên tệp PNG, và máy chủ kiểm magic bytes nên từ chối
  // ("Nội dung tệp không phải định dạng đã khai báo", gặp thật 27/9). Chỉ khi picker không cho biết
  // loại mới coi là JPEG (trường hợp nó thực sự nén lại, vd ảnh chụp từ camera).
  const mime = (a.mimeType ?? "").toLowerCase();
  const type = mime === "image/png" || mime === "image/webp" || mime === "image/jpeg" ? mime : "image/jpeg";
  const ext = type === "image/png" ? ".png" : type === "image/webp" ? ".webp" : ".jpg";
  const base = (a.fileName ?? `anh-${Date.now()}`).replace(/\.(png|jpe?g|heic|heif|webp)$/i, "");
  return { uri: a.uri, name: `${base}${ext}`, type, isImage: true };
}

async function fromCameraOrLibrary(source: "camera" | "library", maxBytes = MAX_BYTES): Promise<PickedFile | null> {
  const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(source === "camera" ? "Cần quyền camera để chụp ảnh." : "Cần quyền truy cập ảnh.");
  const opts = { quality: 0.8 } as const;
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, mediaTypes: ["images"] });
  const a = res.canceled ? null : res.assets?.[0];
  return a ? assetToFile(a, maxBytes) : null;
}

async function fromDocuments(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true });
  const a = res.canceled ? null : res.assets?.[0];
  if (!a) return null;
  if (a.size && a.size > MAX_BYTES) throw new Error("Tệp quá lớn (tối đa 10 MB).");
  const type = a.mimeType ?? extType(a.name);
  return { uri: a.uri, name: a.name, type, isImage: type.startsWith("image/") };
}

/**
 * Dùng chung cho mọi luồng tải tệp của người dùng (hồ sơ PT ở Phase 9, hồ sơ đối tác và giấy tờ ở
 * Phase 12). Trước ở `features/ptApplication/` vì lúc đó chỉ một nơi dùng; chuyển ra `lib` khi nơi
 * thứ hai xuất hiện, thay vì chép thành bản thứ hai.
 *
 * Ask where the file comes from, then pick it. `allowPdf` adds "Tệp PDF" (certificates); identity
 * photos and portfolio are images only, like web's accept lists. Resolves null on cancel.
 */
export function pickApplicationFile(allowPdf: boolean): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    const run = (fn: () => Promise<PickedFile | null>) => () => {
      fn().then(resolve, reject);
    };
    const buttons = [
      { text: "Chụp ảnh", onPress: run(() => fromCameraOrLibrary("camera")) },
      { text: "Thư viện ảnh", onPress: run(() => fromCameraOrLibrary("library")) },
      // Android shows at most three buttons — with "Tệp PDF" there, cancel is a tap outside.
      allowPdf ? { text: "Tệp PDF", onPress: run(fromDocuments) } : { text: "Huỷ", style: "cancel" as const, onPress: () => resolve(null) },
    ];
    Alert.alert("Chọn tệp", undefined, buttons, { cancelable: true, onDismiss: () => resolve(null) });
  });
}

/**
 * 14B.5 — several gallery photos at once (web's multi-file input), or one from the camera. `limit`
 * is how many the gallery still has room for; `maxBytes` the endpoint's own cap (gym photos: 8 MB).
 * Resolves [] on cancel.
 */
export function pickImages(limit: number, maxBytes = MAX_BYTES): Promise<PickedFile[]> {
  return new Promise((resolve, reject) => {
    const library = async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error("Cần quyền truy cập ảnh.");
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        allowsMultipleSelection: limit > 1,
        selectionLimit: Math.max(1, limit),
      });
      return res.canceled ? [] : (res.assets ?? []).slice(0, limit).map((a) => assetToFile(a, maxBytes));
    };
    const camera = async () => {
      const one = await fromCameraOrLibrary("camera", maxBytes);
      return one ? [one] : [];
    };
    Alert.alert(
      "Thêm ảnh",
      undefined,
      [
        { text: "Chụp ảnh", onPress: () => void camera().then(resolve, reject) },
        { text: "Thư viện ảnh", onPress: () => void library().then(resolve, reject) },
        { text: "Huỷ", style: "cancel", onPress: () => resolve([]) },
      ],
      { cancelable: true, onDismiss: () => resolve([]) },
    );
  });
}

