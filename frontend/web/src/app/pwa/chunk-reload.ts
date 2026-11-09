/**
 * Recovery from stale code-split chunks after a deploy.
 *
 * Every deploy renames the hashed chunks (TrainingPage-<hash>.js). A tab — or a cached
 * index.html — from the previous deploy still imports the old names. Once those files are
 * gone, CloudFront's SPA fallback answers them with index.html, and the dynamic import fails
 * with "Failed to fetch dynamically imported module". Observed live on gymini.vn
 * (2026-11-09) as a raw technical error on /client/workout.
 *
 * The fix is to load the current index.html once. A timestamp in sessionStorage stops a
 * reload loop when the chunk is genuinely missing even after reloading.
 */

const RELOAD_KEY = "gymini:stale-chunk-reload-at";
const RELOAD_GUARD_MS = 30_000;

const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk [\w-]+ failed/i;

export interface ReloadDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
  now: () => number;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    const inner = (error as { error?: unknown }).error;
    if (inner && inner !== error) return messageOf(inner);
  }
  return "";
}

/** True for the errors a stale (deleted / renamed) code-split chunk produces. */
export function isChunkLoadError(error: unknown): boolean {
  return CHUNK_ERROR_PATTERN.test(messageOf(error));
}

function browserDeps(): ReloadDeps {
  let storage: ReloadDeps["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null; // storage blocked: still reload, but without a loop guard we only try once per page
  }
  return { storage, reload: () => window.location.reload(), now: () => Date.now() };
}

let reloadedWithoutStorage = false;

/**
 * Reloads the page to pick up the current deploy, unless a reload for the same reason
 * already happened in the last 30 s. Returns true when a reload was triggered.
 */
export function reloadOnceForStaleChunk(deps: ReloadDeps = browserDeps()): boolean {
  const now = deps.now();
  if (deps.storage) {
    let last = 0;
    try {
      last = Number(deps.storage.getItem(RELOAD_KEY)) || 0;
    } catch {
      last = 0;
    }
    if (now - last < RELOAD_GUARD_MS) return false;
    try {
      deps.storage.setItem(RELOAD_KEY, String(now));
    } catch {
      // ignore — the reload below still happens once
    }
  } else {
    if (reloadedWithoutStorage) return false;
    reloadedWithoutStorage = true;
  }
  deps.reload();
  return true;
}

/**
 * Vite fires `vite:preloadError` when a lazy chunk (or its CSS) fails to load. Reloading
 * there recovers before React Router ever renders its error boundary.
 */
export function installStaleChunkReload(target: Pick<Window, "addEventListener"> = window): void {
  target.addEventListener("vite:preloadError", (event: Event) => {
    if (reloadOnceForStaleChunk()) event.preventDefault();
  });
}
