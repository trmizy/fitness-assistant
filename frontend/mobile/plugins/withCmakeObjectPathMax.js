const { withProjectBuildGradle } = require("expo/config-plugins");

/**
 * Windows-only fix: this monorepo's pnpm virtual store path
 * (D:/.ps/<pkg>@<version>_<peer-suffix>/node_modules/...) combined with CMake's own hardcoded
 * CMAKE_OBJECT_PATH_MAX=250 causes some native modules to fail with "ninja: error: manifest
 * 'build.ninja' still dirty after 100 tries" — even though Windows itself has
 * LongPathsEnabled=1 (verified via registry), because CMake enforces this ceiling defensively
 * regardless of OS policy.
 *
 * The two modules whose OWN path was long enough to break in multiple ways (codegen output,
 * vendored source files, not just .cxx staging) are handled separately and more thoroughly by
 * `shortenPackagePaths.js` (junctions the whole package to a short external directory — see
 * that file's header comment for the full history of approaches tried and abandoned for those
 * two specifically). This plugin covers the lighter, more common case: a module whose .cxx
 * staging path alone is long enough to exceed the limit, with everything else about it fine.
 *
 * Tried and failed for raising the ceiling itself: `-DCMAKE_OBJECT_PATH_MAX` via
 * `cmake.arguments`, at three different Gradle lifecycle hook timings — all hit "Could not
 * get/find property/method 'arguments'". Decompiling this AGP version's actual
 * com.android.build.gradle.internal.dsl.CmakeOptions class (javap) shows it only implements
 * `path(Object)`/`setPath` and `buildStagingDirectory(Object)`/`setBuildStagingDirectory` — no
 * working top-level `arguments` accessor exists in this AGP release. `buildStagingDirectory` is
 * the right fix anyway: it relocates CMake/Ninja's `.cxx` intermediate tree outside node_modules/
 * pnpm's virtual store, fixing the root cause directly instead of raising a ceiling.
 *
 * Regenerated on every `expo prebuild` since android/build.gradle itself is not hand-edited.
 */
const MARKER = "// [withCmakeObjectPathMax] relocate .cxx build staging dir for android-library modules";

// Applied to every android-library subproject unconditionally: it's a no-op for modules with no
// real CMake build, so it's safe project-wide, and more than one module (expo-modules-core,
// react-native-screens) has needed it in practice as the dependency tree grew.
const SNIPPET = `
${MARKER}
subprojects { proj ->
    proj.plugins.withId("com.android.library") {
        proj.android.externalNativeBuild.cmake.buildStagingDirectory("D:/.cxx/\${proj.name}")
    }
}
`;

function withCmakeObjectPathMax(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(MARKER)) {
      return config;
    }
    config.modResults.contents += SNIPPET;
    return config;
  });
}

module.exports = withCmakeObjectPathMax;
