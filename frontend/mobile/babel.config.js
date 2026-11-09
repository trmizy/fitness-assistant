// babel-preset-expo is a dependency of `expo`, not of this app. Under pnpm's strict layout it is
// therefore not resolvable from this directory, and Babel resolves a bare preset name relative to
// this config — the EAS cloud build failed with "Cannot find module 'babel-preset-expo'" in
// :app:createBundleReleaseJsAndAssets. Resolving it through `expo` uses exactly the copy expo
// itself depends on, with no new dependency and no lockfile change.
const babelPresetExpo = require.resolve("babel-preset-expo", {
  paths: [require.resolve("expo/package.json")],
});

module.exports = function (api) {
  api.cache(true);
  return {
    // NativeWind was disabled through Phase 1 because enabling it crashed startup with
    // "TypeError: property is not writable" / "Global was not installed" inside
    // setUpDefaltReactNativeEnvironment. That was a SYMPTOM, not an upstream Expo bug: the bundle
    // contained two copies of react-native, so its core setup code ran twice and the second
    // `Object.defineProperty(global, ...)` hit the non-configurable property the first had just
    // installed. metro.config.js now forces a single copy (MOBILE_PLATFORM_ADAPTERS.md §16), and
    // NativeWind boots cleanly.
    presets: [
      [babelPresetExpo, { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    // react-native-reanimated 4.x moved its worklet-transform Babel plugin out to the separate
    // react-native-worklets package (react-native-reanimated/plugin is now just a re-export
    // shim for it) — required for ANY "worklet" code, which react-native-gesture-handler's
    // Fabric integration relies on internally even when no gesture/animation code is written
    // yet. Missing this plugin doesn't throw or crash: it just leaves worklet-driven native
    // setup (e.g. GestureHandlerRootView's Fabric root registration) permanently incomplete,
    // so the view mounts but never paints its children — silent blank screen, no error anywhere.
    // MUST be listed last per Reanimated's own docs.
    plugins: ["react-native-worklets/plugin"],
  };
};
