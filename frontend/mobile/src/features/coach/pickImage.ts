import * as ImagePicker from "expo-image-picker";

import type { AgentImage } from "../../services/api";
import { detectImageMediaType } from "./coach";

export type PickedImage = { uri: string; image: AgentImage };

/**
 * Camera or library → the base64 JPEG/PNG the `/ai/agent/*` image endpoints take. Same 4 MB cap web
 * checks before upload (base64 is ~4/3 of the bytes). Resolves `null` when the user cancels;
 * throws a Vietnamese message the screen can show as-is.
 */
export async function pickAgentImage(source: "camera" | "library"): Promise<PickedImage | null> {
  const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(source === "camera" ? "Cần quyền camera để chụp ảnh." : "Cần quyền truy cập ảnh.");
  const options = { quality: 0.6, base64: true } as const;
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ["images"] });
  const asset = res.canceled ? null : res.assets?.[0];
  if (!asset?.base64) return null;
  const mediaType = detectImageMediaType(asset.base64);
  if (!mediaType || asset.base64.length * 0.75 > 4 * 1024 * 1024) throw new Error("Chọn ảnh JPEG/PNG dưới 4 MB.");
  return { uri: asset.uri, image: { mediaType, base64: asset.base64 } };
}
