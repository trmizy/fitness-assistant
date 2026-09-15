const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
// Required lazily (inside withShortenPackagePaths only) rather than at module top level: the
// standalone runner (scripts/shorten-package-paths.js) must be callable with plain `node`,
// before `expo prebuild`'s own dependency setup, and @expo/config-plugins isn't necessarily
// resolvable as a direct require target outside Expo's own CLI/plugin-loading context.

/**
 * Windows-only fix for native modules whose pnpm virtual-store folder name is long enough
 * (peer-dependency suffix, e.g. `_@babel+core@7.28.6_@react-native+metro-config@0.87.1_
 * react-native@0.86.3_react@19.2.3`) that paths derived from it — CMake's own generated `.cxx`
 * staging dir, RN codegen output (`android/build/generated/source/codegen/...`, computed via a
 * CMakeLists.txt-internal `${CMAKE_SOURCE_DIR}/build` with NO Gradle-side override — confirmed
 * by reading the vendor source directly), and even the module's own vendored *.cpp source files
 * — exceed Windows' 260-char MAX_PATH / CMake's 250-char CMAKE_OBJECT_PATH_MAX.
 *
 * Tried and abandoned before this: raising CMAKE_OBJECT_PATH_MAX via cmake.arguments (no working
 * API in this AGP release), redirecting only cmake.buildStagingDirectory + Gradle buildDir for
 * worklets specifically (fixed worklets' own compile, but broke `:app`'s separate
 * Android-autolinking.cmake, which ALSO hardcodes worklets' *default* unredirected codegen path
 * — a third, independent reference to the same path that a buildDir-only redirect can't reach),
 * patching just the CMakeLists.txt BUILD_DIR line alone (same mismatch, inverted).
 *
 * The one approach that needs no per-consumer patching at all: give the WHOLE package a short
 * physical location. Gradle's default buildDir (`<project>/build`) and CMakeLists.txt's own
 * `CMAKE_SOURCE_DIR`-relative BUILD_DIR are both automatically short once the package's own root
 * directory is short — every consumer (the module's own CMake build, :app's autolinking, the
 * module's vendored source tree) agrees by construction, since none of them needed to be told
 * about a redirect in the first place.
 *
 * Copies each named package's real content (resolved through pnpm's virtual store) to a short
 * fixed directory, then replaces this project's node_modules/<pkg> symlink with a Windows
 * junction pointing at the short copy (junctions need no admin/Developer-Mode privileges, unlike
 * symlinks). Confirmed NOT the same failure mode as `subst` (tried and abandoned for the whole
 * repo root): subst aliases a drive letter back to the SAME original long-path content, so
 * Windows' path-canonicalization APIs collapse it right back to the long path. Here the
 * junction's target is an independent, real copy — resolving it yields the short path directly.
 *
 * Idempotent (skips the copy if the short-path copy's package.json version already matches) and
 * re-applied on every `expo prebuild`, since pnpm recreates the default long symlink on every
 * `pnpm install`, which would otherwise silently undo this.
 */
const SHORTENED_PACKAGES = {
  "react-native-reanimated": "D:/.rnr",
  "react-native-worklets": "D:/.rnw",
  // react-native itself is next: its own peer-suffix (@babel+core, @react-native+metro-config,
  // @types+react, react) is comparably long, and its own vendored headers
  // (ReactCommon/react/renderer/graphics/platform/cxx/.../HostPlatformColor.h) hit the exact
  // same "Filename longer than 260 characters" failure once worklets/reanimated stopped being
  // the bottleneck. Expect more entries here as the dependency tree grows — this is a recurring
  // category of failure (any native module with a long enough peer-suffix), not a one-off.
  "react-native": "D:/.rn",
  "@react-native-async-storage/async-storage": "D:/.ras",
  // These four are the next in line by the exact same codegen-path pattern (confirmed: :app's
  // own CMake invocation explicitly targets react_codegen_rnscreens/rnsvg/safeareacontext
  // alongside appmodules) — added proactively together rather than one failure at a time, since
  // the pattern is now well-established and re-running the full relink+prebuild+build cycle for
  // each individually is pure overhead once the fix itself is known to work.
  "react-native-gesture-handler": "D:/.rngh",
  "react-native-safe-area-context": "D:/.rnsa",
  "react-native-screens": "D:/.rnscr",
  "react-native-svg": "D:/.rnsvg",
  "react-native-webrtc": "D:/.rnwebrtc",
};

function versionMatches(shortDir, sourceVersion) {
  const shortPkgJson = path.join(shortDir, "package.json");
  if (!fs.existsSync(shortPkgJson)) return false;
  try {
    return JSON.parse(fs.readFileSync(shortPkgJson, "utf8")).version === sourceVersion;
  } catch {
    return false;
  }
}

function robocopyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  // Node's fs.cpSync silently died (no exception, no stack trace, exit 127) partway through a
  // ~2500-file tree — reproduced standalone outside any Expo/Gradle context, so it's a Node/
  // Windows bulk-copy issue, not this script's logic (suspected real-time antivirus intervention
  // on rapid small-file creation, never confirmed). robocopy is Windows' own battle-tested
  // bulk-copy tool and completed the identical copy (verified matching file count) in seconds.
  try {
    execFileSync("robocopy", [src, dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS"], { stdio: "pipe" });
  } catch (e) {
    // robocopy's exit codes are a bitmask where 0-7 all mean "succeeded" (0 = nothing to copy,
    // 1 = files copied); only 8+ is a real failure. execFileSync throws on ANY non-zero code, so
    // this must be inspected explicitly rather than trusting a plain try/catch-free call.
    if (typeof e.status !== "number" || e.status >= 8) {
      throw new Error(`robocopy ${src} -> ${dest} failed with exit code ${e.status}: ${e.stderr}`);
    }
  }
}

// pnpm's per-context isolation puts a package's resolved dependencies as SIBLINGS one level up,
// not nested inside the package's own folder: for react-native specifically, `nullthrows`,
// `invariant`, `abort-controller`, etc. all live in
// `.pnpm/react-native@<peers>/node_modules/` (the same folder react-native ITSELF is a symlink
// entry of), while `.pnpm/react-native@<peers>/node_modules/react-native/node_modules/` is
// genuinely empty (confirmed by direct inspection). Node's module resolution, walking up from
// inside react-native's own files, checks react-native's own (empty) node_modules first, then
// the parent — landing on this sibling folder, which is why it normally works with no special
// handling in the original pnpm layout. Once react-native is copied out to a standalone short
// directory, that parent-with-siblings folder no longer exists above it, so Metro/Node fail to
// resolve react-native's own transitive imports ("Unable to resolve 'nullthrows'").
//
// This is RECURSIVE, not one level: a sibling can have its own siblings-with-dependencies the
// exact same way (confirmed: `yargs` — one of react-native's 28 siblings — itself needs
// `yargs-parser`, only discovered once `nullthrows` and friends were already fixed and the build
// got one step further: "TypeError: v(...).Parser.looksLikeNumber is not a function", a version-
// mismatch symptom of yargs finding the WRONG or no yargs-parser). Walks the whole reachable set
// of pnpm sibling-context folders via BFS, flattening every distinct package name into ONE
// node_modules folder under destDir (not preserving pnpm's per-context nesting) — simpler and
// good enough for this dependency subtree (small utility libs, not expected to need conflicting
// versions of the same package here); `visited` prevents infinite loops and redundant copying.
//
// CRITICAL EXCLUSION: `react` and every package in SHORTENED_PACKAGES must NEVER be flattened in
// here. Confirmed by direct inspection (Phase 1 ANR-on-every-touch + invisible NativeWind text
// investigation) that this function was copying a SEPARATE physical copy of `react` and
// `react-native` into e.g. `D:/.rngh/node_modules/react-native` (react-native-gesture-handler is
// a sibling of react-native in pnpm's graph, so the BFS walk reached it) — Node's resolution finds
// that nested copy FIRST (nearest node_modules walking up from D:/.rngh's own files), before ever
// falling back to metro.config.js's nodeModulesPaths. Result: react-native-gesture-handler's
// native view manager registered its touch handling against a DIFFERENT react-native module
// instance (different NativeEventEmitter/UIManager/TurboModuleRegistry singleton state) than the
// one Fabric actually renders through — every real touch's JS-side acknowledgment went to the
// wrong instance and never arrived, so Android's InputDispatcher waited forever and ANR'd
// ("Input dispatching timed out ... Waited 15000ms for MotionEvent"), reproducible on every tap
// anywhere in the window, even on unrelated native UI. Likely also why NativeWind-applied styles
// never painted (react-native-reanimated / react-native-worklets suffered the same duplication).
// For these singleton-sensitive packages, skip the copy AND do not traverse into them — leave
// resolution to fall through to metro.config.js's nodeModulesPaths, which lands on the ONE
// canonical top-level copy (either this project's own node_modules/react, or another entry in
// SHORTENED_PACKAGES's own junction) that every other part of the app also resolves to.
const SINGLETON_PACKAGES = new Set(["react", ...Object.keys(SHORTENED_PACKAGES)]);

function flattenTransitiveDeps(realSourceDir, destDir) {
  const nestedDest = path.join(destDir, "node_modules");
  const visited = new Set([realSourceDir]);
  const queue = [realSourceDir];

  while (queue.length > 0) {
    const currentRealDir = queue.shift();

    // For a scoped package (@scope/name), the immediate parent is the "@scope" folder, not the
    // true siblings directory — that's one level further up.
    const immediateParent = path.dirname(currentRealDir);
    const isScoped = path.basename(immediateParent).startsWith("@");
    const siblingsDir = isScoped ? path.dirname(immediateParent) : immediateParent;
    const ownLeafName = isScoped ? path.basename(immediateParent) : path.basename(currentRealDir);

    let siblingEntries;
    try {
      siblingEntries = fs.readdirSync(siblingsDir);
    } catch {
      continue; // no sibling-context folder for this package (e.g. it's not pnpm-isolated) — fine
    }

    for (const entry of siblingEntries) {
      if (entry === ".bin" || entry === ownLeafName) continue;
      const entryPath = path.join(siblingsDir, entry);

      // Scoped packages (@scope/name) are a directory of further entries, not a package itself.
      const targets = entry.startsWith("@")
        ? fs.readdirSync(entryPath).map((scopedEntry) => ({
            name: `${entry}/${scopedEntry}`,
            destRel: path.join(entry, scopedEntry),
            realTarget: fs.realpathSync(path.join(entryPath, scopedEntry)),
          }))
        : [{ name: entry, destRel: entry, realTarget: fs.realpathSync(entryPath) }];

      for (const { name, destRel, realTarget } of targets) {
        if (SINGLETON_PACKAGES.has(name)) continue;

        const destPath = path.join(nestedDest, destRel);
        if (!fs.existsSync(destPath)) {
          robocopyDir(realTarget, destPath);
        }
        if (!visited.has(realTarget)) {
          visited.add(realTarget);
          queue.push(realTarget);
        }
      }
    }
  }
}

function shortenPackagePath(projectRoot, pkgName, shortDir) {
  let sourceDir;
  let sourceVersion;
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`, { paths: [projectRoot] });
    sourceDir = path.dirname(pkgJsonPath);
    sourceVersion = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).version;
  } catch (e) {
    console.warn(`[shortenPackagePaths] ${pkgName} not found, skipping:`, e.message);
    return;
  }

  const realSourceDir = fs.realpathSync(sourceDir);

  if (!versionMatches(shortDir, sourceVersion)) {
    console.log(`[shortenPackagePaths] Copying ${pkgName}@${sourceVersion} to ${shortDir}...`);
    robocopyDir(realSourceDir, shortDir);
    flattenTransitiveDeps(realSourceDir, shortDir);
  }

  const linkPath = path.join(projectRoot, "node_modules", pkgName);
  const currentTarget = fs.existsSync(linkPath) ? fs.realpathSync(linkPath) : null;
  if (currentTarget === fs.realpathSync(shortDir)) {
    return; // already pointing at the short copy
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(shortDir, linkPath, "junction");
  console.log(`[shortenPackagePaths] Relinked ${linkPath} -> ${shortDir}`);
}

function shortenAllPackagePaths(projectRoot) {
  for (const [pkgName, shortDir] of Object.entries(SHORTENED_PACKAGES)) {
    shortenPackagePath(projectRoot, pkgName, shortDir);
  }
}

// Kept as a config plugin too so a plain `expo prebuild` (without remembering to run the
// standalone script first) still re-applies the relink for anything that DOESN'T depend on
// prebuild-time-baked absolute paths — belt and suspenders, not a substitute for running
// scripts/shorten-package-paths.js first (see that file's header for why order matters).
function withShortenPackagePaths(config) {
  // `expo/config-plugins`, not `@expo/config-plugins`: the scoped package is not a direct dependency,
  // so pnpm does not link it into frontend/mobile/node_modules. It resolved during `expo prebuild`
  // but NOT when Gradle's :expo-constants:createExpoConfig spawns node for a release build —
  // "Cannot find module '@expo/config-plugins'". `expo` re-exports it and IS a direct dependency.
  const { withDangerousMod } = require("expo/config-plugins");
  return withDangerousMod(config, [
    "android",
    async (config) => {
      shortenAllPackagePaths(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

module.exports = withShortenPackagePaths;
module.exports.shortenAllPackagePaths = shortenAllPackagePaths;
// metro.config.js needs the same list to force every import of these packages onto the ONE
// relocated copy — see the resolveRequest hook there for why leaving Metro to resolve them
// normally silently produced two module instances of react-native.
module.exports.SHORTENED_PACKAGES = SHORTENED_PACKAGES;
