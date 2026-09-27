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

async function fromCameraOrLibrary(source: "camera" | "library"): Promise<PickedFile | null> {
  const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(source === "camera" ? "Cần quyền camera để chụp ảnh." : "Cần quyền truy cập ảnh.");
  const opts = { quality: 0.8 } as const;
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, mediaTypes: ["images"] });
  const a = res.canceled ? null : res.assets?.[0];
  if (!a) return null;
  if (a.fileSize && a.fileSize > MAX_BYTES) throw new Error("Ảnh quá lớn (tối đa 10 MB).");
  // Re-encoded by the picker (quality < 1): always JPEG bytes, whatever the source file was.
  const name = (a.fileName ?? `anh-${Date.now()}`).replace(/\.(png|heic|webp)$/i, ".jpg");
  return { uri: a.uri, name: /\.jpe?g$/i.test(name) ? name : `${name}.jpg`, type: "image/jpeg", isImage: true };
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
