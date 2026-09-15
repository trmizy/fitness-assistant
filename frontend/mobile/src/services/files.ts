import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

// Deliberately NOT `import { API_URL } from "./api"`: api.ts is about to depend on this module,
// and a cycle between them is a real hazard for a mutable binding like API_URL. config/serverUrl
// is the actual source of truth for the address anyway, and reading it per call means a server
// address changed in-app applies to the very next download.
import { apiBaseUrl } from "../config/serverUrl";
import { tokenStore } from "./tokenStore";

/**
 * The RN replacement for web's two file idioms, both of which are browser-only:
 *
 *  - private files shown in the UI: web fetched them as a Blob (auth header required) and made an
 *    object URL for `<img src>`/`<embed>`. There is no object URL here, so the bytes have to land
 *    in a real file whose `file://` URI an `<Image>`/viewer can point at.
 *  - downloads: web made a Blob URL and clicked a hidden `<a download>`. Native has no browser
 *    download; the file is written to app storage and handed to the OS share sheet instead.
 *
 * See MOBILE_PLATFORM_ADAPTERS.md §3 (download) and §4 (viewing documents).
 *
 * Downloads go through expo-file-system's native downloader rather than axios, so the bytes never
 * pass through JS — that matters for the verification documents, which can be multi-megabyte PDFs.
 * The access token is attached by hand because this bypasses the axios interceptor.
 */

/** Where downloaded files live. Cache, not documents: every file here is re-fetchable from the
 *  server, so the OS is free to reclaim the space under pressure. */
function downloadDirectory(): Directory {
  const dir = new Directory(Paths.cache, "downloads");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Strips anything that cannot safely be a file name on disk. */
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
}

/**
 * Downloads an authenticated endpoint to local storage and returns its `file://` URI.
 *
 * `path` is relative to the gateway, exactly as the axios services write it (e.g.
 * "/owner/branch-documents/abc123").
 */
export async function downloadAuthenticatedFile(
  path: string,
  fileName: string,
): Promise<string> {
  const token = tokenStore.get();
  const destination = new File(downloadDirectory(), safeFileName(fileName));

  const downloaded = await File.downloadFileAsync(`${apiBaseUrl()}${path}`, destination, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // Re-downloading the same document must overwrite, not throw.
    idempotent: true,
  });

  return downloaded.uri;
}

/**
 * Hands a local file to the OS share sheet — the native equivalent of a browser download, and the
 * only way to get a file out of the app sandbox and into the user's own storage/apps.
 */
export async function shareLocalFile(uri: string, mimeType?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Thiết bị không hỗ trợ chia sẻ tệp.");
  }
  await Sharing.shareAsync(uri, mimeType ? { mimeType } : undefined);
}

/** Writes bytes the app already holds in memory to a local file and returns its URI. Used by the
 *  export endpoints, which need their response headers read (for the server's file name) and so
 *  cannot use the native downloader above. */
export function writeLocalFile(fileName: string, contents: string): string {
  const file = new File(downloadDirectory(), safeFileName(fileName));
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  return file.uri;
}
