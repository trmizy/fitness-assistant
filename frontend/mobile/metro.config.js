const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// react-native-webrtc depends on event-target-shim@6, while React Native itself bundles
// event-target-shim@5 — without this alias, Metro resolves the wrong major version and
// WebRTC event listeners silently fail. See MOBILE_PLATFORM_ADAPTERS.md / known-issue notes
// gathered during Phase 1 dependency research.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "event-target-shim": require.resolve("event-target-shim"),
};

// plugins/shortenPackagePaths.js relocates several packages (react-native itself included) to
// short external directories (D:/.rn, D:/.rnr, ...) outside node_modules entirely, to work
// around Windows' 260-char MAX_PATH for their own deep CMake/codegen/source paths. Side effect:
// Metro's normal node_modules resolution walks UP from the FILE doing the import — for a file
// under D:/.rn/Libraries/..., that walk never reaches frontend/mobile/node_modules (D:/.rn isn't
// nested under it), so react-native's OWN transitive deps (nullthrows, invariant, ...) fail to
// resolve ("Unable to resolve 'nullthrows' from '..\.rn\Libraries\...'"). Explicitly adding this
// project's own node_modules as an extra search root fixes every such transitive import in one
// place, rather than aliasing each dependency individually as they're discovered one at a time.
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths || []),
  path.resolve(__dirname, "node_modules"),
];

// Force every import of a relocated package onto its ONE short copy.
//
// Why this is load-bearing, not tidiness: shortenPackagePaths.js only replaces the TOP-LEVEL
// `frontend/mobile/node_modules/<pkg>` with a junction to the short dir. pnpm also gives every
// dependent package its own sibling link — `node_modules/.pnpm/<dependent>/node_modules/<pkg>` —
// and those still point at the original store copy, which is left in place. So app code resolved
// react-native through the junction (`../../../.rn/...`) while every pnpm-installed package (expo,
// expo-router, ...) resolved it through the store path, and Metro — which keys its module cache by
// resolved path string — put BOTH copies of the entire library in the bundle: measured at 558 and
// 522 modules respectively for one build.
//
// Two copies of react-native means two of every module-level singleton inside it. The one that
// breaks visibly is ReactNativeViewConfigRegistry: components register their view configs into
// instance A while the Fabric renderer reads instance B, so lookups come back empty. Observed
// symptoms, all from this single cause: "View config getter callback for component
// `AndroidProgressBar` must be a function (received `undefined`)" (any ActivityIndicator),
// the same for `RCTScrollView` (any ScrollView), and 'Unsupported top level event type
// "topLayout"/"topFocus"/"topInsetsChange" dispatched' for events whose dispatch config lives on a
// view config the renderer cannot see. See MOBILE_PLATFORM_ADAPTERS.md §16.
const { SHORTENED_PACKAGES } = require("./plugins/shortenPackagePaths");

const RELOCATED_PACKAGE_NAMES = Object.keys(SHORTENED_PACKAGES);
const originalResolveRequest = config.resolver.resolveRequest;

// Resolution is re-run as if it came from a file at the project root, whose own
// node_modules/<pkg> IS the junction to the short dir. Deliberately NOT done by handing Metro the
// absolute short path — Metro reads a rewritten module name as a module specifier, not a
// filesystem path, and turns "D:/.rn" into a doomed relative lookup ("..\..\..\.rn"). Re-entering
// the normal resolver with a different origin keeps platform extensions, "exports"/"main" and the
// rest of Metro's semantics exactly as they were; only the node_modules walk changes.
const projectRootOrigin = path.join(__dirname, "index.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isRelocated = RELOCATED_PACKAGE_NAMES.some(
    // Exact package, or a deep import into it. The `/` guard matters: without it "react-native"
    // would also swallow "react-native-svg", "react-native-screens" and every other sibling.
    (pkgName) => moduleName === pkgName || moduleName.startsWith(`${pkgName}/`),
  );

  if (isRelocated && context.originModulePath !== projectRootOrigin) {
    return config.resolver.resolveRequest(
      { ...context, originModulePath: projectRootOrigin },
      moduleName,
      platform,
    );
  }

  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./src/theme/global.css" });
