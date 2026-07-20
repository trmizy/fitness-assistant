const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Since SDK 52, expo/metro-config auto-detects the monorepo (reads
// pnpm-workspace.yaml) and sets watchFolders to every workspace package's
// root + the workspace node_modules — DO NOT override this list. Confirmed
// by trial (see DECISIONS.md "LAN — Bug thật... EACCES" + its SDK-54
// follow-up): expo-router's entry-point resolution (`main: "expo-router/
// entry"`) depends on Metro's watchFolders matching what @expo/cli's own
// monorepo detection expects. Narrowing watchFolders to just [projectRoot]
// (or projectRoot + backend/shared) made `expo export`/`expo start` fail
// with "Unable to resolve module .../expo-router/entry.js" — a known
// expo-router+pnpm-monorepo issue, not specific to this repo.
//
// The FULL auto-detected watch scope used to crash Metro's Windows
// filesystem walker (FallbackWatcher, used since Watchman isn't available)
// with EACCES on `lstat`. Two distinct causes, two different fixes:
//
//   1. Reparse points/junctions inside individual backend services'
//      node_modules (e.g. Prisma engine cache artifacts). Fixed here via
//      `resolver.blockList` — metro-file-map applies this as a
//      per-DIRECTORY `filterDir` skip (confirmed by reading
//      FallbackWatcher.js's source), which works for this case because the
//      pattern matches the node_modules directory ITSELF, causing the
//      walker to never descend into it at all.
//   2. ~100 broken reparse-point stubs scattered across the ROOT
//      `node_modules/.pnpm` store, for foreign-platform optional native
//      binaries (esbuild, rollup, lightningcss, @tailwindcss/oxide,
//      msgpackr-extract, fsevents — each ships one npm package per
//      OS/arch as an optionalDependency; pnpm left an inaccessible
//      reparse-point stub for every platform that isn't this one, instead
//      of omitting them — confirmed via PowerShell
//      `Get-ChildItem -Recurse -Attributes ReparsePoint`: exactly 102).
//      `resolver.blockList` does NOT fix this class — those crash on the
//      `lstat` used to CLASSIFY each entry while listing an
//      already-being-walked PARENT directory (e.g. `.pnpm/lightningcss@…/
//      node_modules/`), which runs unconditionally before `filterDir` ever
//      gets a chance to decide whether to recurse into the CHILD. Verified
//      empirically: even a blockList pattern that correctly matches the
//      broken child directory did not stop the crash. The actual fix was
//      deleting the 102 corrupted stubs directly from disk (`fsutil
//      reparsepoint delete` then `Remove-Item`, since a plain
//      `Directory.Delete`/`rmdir` fails with "the directory name is
//      invalid" on these). They regenerate on a future `pnpm install`
//      unless prevented at the pnpm-config level — attempted
//      `pnpm.supportedArchitectures` in package.json but pnpm 8.15
//      doesn't read it there ("no longer read by pnpm" warning); not
//      chased further since the immediate blocker is resolved. If this
//      recurs after a fresh install, re-run the PowerShell cleanup
//      documented in DECISIONS.md before assuming Metro itself regressed.
//
// The blockList below still blocks foreign-platform package directories
// by name pattern (defense in depth against Metro ever trying to RESOLVE
// into one, independent of the watcher-crash issue above, which is fixed
// by keeping node_modules clean of the corrupted stubs, not by this list).
const PLATFORM_OS_TOKENS =
  "aix|android|darwin|freebsd|linux|netbsd|openbsd|openharmony|sunos|win32|wasm32";
config.resolver.blockList = [
  // backend/services/*, backend/gateway, frontend/* node_modules — not
  // needed for resolution (mobile only imports from backend/shared, whose
  // own node_modules IS still watched since it's a legitimate dependency).
  /[\\/]backend[\\/]services[\\/][^\\/]+[\\/]node_modules$/,
  /[\\/]backend[\\/]gateway[\\/]node_modules$/,
  /[\\/]frontend[\\/][^\\/]+[\\/]node_modules$/,
  // Bare "<os>-<arch>" package dirs, e.g. @esbuild/linux-x64
  new RegExp(`[\\\\/](${PLATFORM_OS_TOKENS})-[\\w]+$`),
  // "<pkg-name>-<os>[-<arch>][-<libc>]" dirs, e.g. lightningcss-darwin-arm64,
  // @tailwindcss/oxide-linux-x64-musl, rollup-openharmony-arm64,
  // @msgpackr-extract/msgpackr-extract-linux-arm64 (hyphenated pkg name —
  // needs "-" allowed in the prefix class too, not just \w)
  new RegExp(`[\\\\/][\\w@.-]+-(${PLATFORM_OS_TOKENS})(-[\\w]+)*$`),
  // macOS-only fsevents (doesn't follow the suffix convention above)
  /[\\/]fsevents$/,
];

// pnpm uses symlinks for workspace packages (backend/shared, etc.) —
// Metro must follow them instead of treating them as opaque node_modules.
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
