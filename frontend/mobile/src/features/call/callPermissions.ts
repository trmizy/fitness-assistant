import { PermissionsAndroid, Platform } from "react-native";

/**
 * Android: ask for the mic (and camera for video) and WAIT for the answer before touching getUserMedia. When
 * react-native-webrtc raised the dialog itself, the first getUserMedia failed while the dialog was still open, so the
 * first video tap placed no call (real phone, 19/11); after "Allow" the second tap worked. Never throws: a denial just
 * lets getUserMedia fail as before (audio-only fallback / "cấp quyền" message). iOS asks inside getUserMedia.
 */
export async function requestCallPermissions(callType: "VOICE" | "VIDEO"): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (callType === "VIDEO") wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    await PermissionsAndroid.requestMultiple(wanted);
  } catch {
    /* getUserMedia reports the real outcome */
  }
}
