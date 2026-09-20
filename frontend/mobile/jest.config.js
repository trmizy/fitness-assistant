const path = require("path");
const { SHORTENED_PACKAGES } = require("./plugins/shortenPackagePaths");

/**
 * Component tests run under jest-expo, which brings the React Native preset (transforms, mocks for
 * the native modules, the RN environment).
 *
 * The `moduleNameMapper` below is the third instance of the same fix: every relocated package has
 * to resolve to its ONE short copy, or Jest — which, like Metro and tsc, keys modules by resolved
 * path — ends up with two react-natives and the mocks land on the wrong one. Metro does it with a
 * resolveRequest hook (metro.config.js) and tsc with `paths` (tsconfig.json); this is Jest's turn.
 * The list is read from the same source as those, so it cannot drift.
 *
 * See MOBILE_PLATFORM_ADAPTERS.md §16.
 */
const relocatedModuleMap = Object.fromEntries(
  Object.entries(SHORTENED_PACKAGES).flatMap(([pkgName, shortDir]) => [
    // Deep imports first: a bare-name pattern would otherwise swallow them.
    [`^${pkgName.replace("/", "\\/")}\\/(.*)$`, path.join(shortDir, "$1")],
    [`^${pkgName.replace("/", "\\/")}$`, shortDir],
  ]),
);

/**
 * `react` is pinned to this project's own copy for the same reason tsconfig pins it: a file inside
 * a relocated directory (D:/.rnr, ...) sits outside the project tree, so Jest's walk-up never finds
 * `frontend/mobile/node_modules` and falls through to whatever else is reachable — here it landed
 * on `@types/react/index.d.ts` and tried to execute a declaration file as CommonJS.
 */
const reactModuleMap = {
  "^react$": path.resolve(__dirname, "node_modules/react"),
  "^react/(.*)$": path.resolve(__dirname, "node_modules/react/$1"),
  "^react-dom$": path.resolve(__dirname, "node_modules/react-dom"),
};

/**
 * lucide-react-native's `react-native` export condition points at a `.mjs` bundle, and jest-expo's
 * transform only covers `\.[jt]sx?$` — so the file arrives as raw ESM and fails to load. The
 * package ships an equivalent CommonJS build; pointing tests at it avoids teaching Jest about
 * `.mjs` for one dependency. Metro handles the ESM build fine, so the app is unaffected.
 */
const cjsOverrides = {
  "^lucide-react-native$": path.resolve(
    __dirname,
    "node_modules/lucide-react-native/dist/cjs/lucide-react-native.js",
  ),
};

/**
 * jest-expo's ignore list is EXTENDED here, never replaced — replacing it drops the `.pnpm`
 * allowance this repo's layout depends on, and the preset's own ESM setup file then fails to load.
 *
 * Two things make the default list insufficient:
 *
 *  - Under pnpm a package's real path contains `/node_modules/` twice
 *    (`node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>/...`). The pattern matches at the SECOND
 *    one, so allowing `.pnpm` is not enough — each ESM-shipping package has to be named too.
 *  - The relocated directories (D:/.rn, ...) are not inside any `node_modules`, so no pattern here
 *    describes them and they are transformed by default. That is what their raw Flow/JSX needs.
 */
const ESM_PACKAGES_NEEDING_TRANSFORM = [
  "lucide-react-native",
  "nativewind",
  "react-native-css-interop",
];

const transformIgnorePatterns = require("jest-expo/jest-preset").transformIgnorePatterns.map(
  (pattern) =>
    pattern.includes("(?!(.pnpm")
      ? pattern.replace("(?!(.pnpm", `(?!(${ESM_PACKAGES_NEEDING_TRANSFORM.join("|")}|.pnpm`)
      : pattern,
);

module.exports = {
  preset: "jest-expo",
  moduleNameMapper: { ...cjsOverrides, ...reactModuleMap, ...relocatedModuleMap },
  resolver: "<rootDir>/jest.resolver.js",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: [
    "<rootDir>/src/**/__tests__/**/*.test.tsx",
    "<rootDir>/src/services/__tests__/api/**/*.test.ts",
  ],
  transformIgnorePatterns,
};
