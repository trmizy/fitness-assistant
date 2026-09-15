const fs = require("fs");
const path = require("path");

/**
 * Works around a real upstream fragility in `@expo/metro-runtime`'s
 * `src/location/install.native.ts`: its `Object.defineProperty(global, 'fetch', { value: ... })`
 * calls omit `configurable`/`writable`, so the very first successful call locks `global.fetch`
 * into a permanently non-redefinable property (JS defaults both flags to `false` when omitted).
 * The file's own top-of-file comment ("we're relying on `getModulesRunBeforeMainModule` which is
 * unstable or can be missing") already flags that this module's load order isn't guaranteed
 * exactly once — confirmed via a live repro + Metro's /symbolicate endpoint (Phase 1 bootstrap):
 * when this module's global code runs a second time (observed here via LogBox's error-UI import
 * chain re-pulling it in), the second `Object.defineProperty` throws
 * `TypeError: property is not writable` inside `setUpDefaltReactNativeEnvironment`'s own require
 * chain, which is fatal enough to block "Running main" entirely.
 *
 * Fix: make both `fetch` redefinitions explicitly `configurable: true, writable: true`, so a
 * second (or Nth) execution of this module's global code re-defines the property instead of
 * throwing. Safe regardless of cause — `fetch` is meant to be swappable/wrappable here by design.
 *
 * Re-apply after every `pnpm install` (pnpm recreates the pristine file on every install, same as
 * the short-path junctions in shortenPackagePaths.js — see that file's own header for why).
 */
const FILES = [
  {
    // install.native.ts's own `global.fetch` redefinition.
    relPath: "src/location/install.native.ts",
    replacements: [
      {
        from: `  // Polyfill native fetch to support relative URLs
  Object.defineProperty(global, 'fetch', {
    // value: fetch,
    value: wrapFetchWithWindowLocation(fetch),
  });`,
        to: `  // Polyfill native fetch to support relative URLs
  Object.defineProperty(global, 'fetch', {
    configurable: true, // [patchExpoMetroRuntimeFetch]
    writable: true, // [patchExpoMetroRuntimeFetch]
    // value: fetch,
    value: wrapFetchWithWindowLocation(fetch),
  });`,
      },
      {
        from: `  // Polyfill native fetch to support relative URLs
  Object.defineProperty(global, 'fetch', {
    value: fetch,
  });`,
        to: `  // Polyfill native fetch to support relative URLs
  Object.defineProperty(global, 'fetch', {
    configurable: true, // [patchExpoMetroRuntimeFetch]
    writable: true, // [patchExpoMetroRuntimeFetch]
    value: fetch,
  });`,
      },
    ],
  },
  {
    // Location.native.ts's `install()` sets `window.location` as a get/set accessor without
    // `configurable: true` (unlike the `Location` constructor redefinition right above it in the
    // same function, which the library authors DID mark configurable) — the actual throw site
    // for this whole class of bug, confirmed by direct source reading after `install.native.ts`'s
    // own fetch patch alone didn't stop the crash (Metro's /symbolicate kept collapsing the real
    // frame to unrelated library code, e.g. react-is.development.js, so static source reading was
    // more reliable here than trusting the symbolicated position).
    relPath: "src/location/Location.native.ts",
    replacements: [
      {
        from: `  Object.defineProperty(window, 'location', {
    get() {
      return location;
    },
    set() {
      throw new DOMException(\`Cannot set "location".\`, 'NotSupportedError');
    },
    enumerable: true,
  });`,
        to: `  Object.defineProperty(window, 'location', {
    configurable: true, // [patchExpoMetroRuntimeFetch]
    get() {
      return location;
    },
    set() {
      throw new DOMException(\`Cannot set "location".\`, 'NotSupportedError');
    },
    enumerable: true,
  });`,
      },
    ],
  },
];

function findExpoMetroRuntimeFile(projectRoot, relPath) {
  // @expo/metro-runtime is a transitive dependency (via expo-router/expo), not a direct
  // dependency of frontend/mobile, so pnpm never symlinks it into frontend/mobile/node_modules —
  // require.resolve() from this script has no path that reaches it. Search the workspace root's
  // pnpm virtual store directly instead (same reason shortenPackagePaths.js's own packages are
  // resolved via the project's direct node_modules: only DIRECT deps get a top-level symlink).
  const workspaceRoot = path.resolve(projectRoot, "../..");
  const pnpmDir = path.join(workspaceRoot, "node_modules", ".pnpm");
  let entries;
  try {
    entries = fs.readdirSync(pnpmDir);
  } catch {
    return null;
  }
  const match = entries.find((e) => e.startsWith("@expo+metro-runtime@"));
  if (!match) return null;
  return path.join(pnpmDir, match, "node_modules", "@expo", "metro-runtime", relPath);
}

function patchFile(projectRoot, { relPath, replacements }) {
  const filePath = findExpoMetroRuntimeFile(projectRoot, relPath);

  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(`[patchExpoMetroRuntimeFetch] @expo/metro-runtime ${relPath} not found, skipping`);
    return;
  }

  let content = fs.readFileSync(filePath, "utf8");

  if (content.includes("[patchExpoMetroRuntimeFetch]")) {
    return; // already patched
  }

  let appliedAny = false;
  for (const { from, to } of replacements) {
    if (content.includes(from)) {
      content = content.replace(from, to);
      appliedAny = true;
    }
  }

  if (!appliedAny) {
    console.warn(`[patchExpoMetroRuntimeFetch] expected pattern not found in ${filePath} — package version may have changed, skipping`);
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
  console.log(`[patchExpoMetroRuntimeFetch] Patched ${filePath}`);
}

function patchExpoMetroRuntimeFetch(projectRoot) {
  for (const file of FILES) {
    patchFile(projectRoot, file);
  }
}

module.exports = { patchExpoMetroRuntimeFetch };

if (require.main === module) {
  patchExpoMetroRuntimeFetch(path.join(__dirname, ".."));
}
