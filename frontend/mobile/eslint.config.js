// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

/** Globals for the CommonJS config files and build scripts, which run in Node/Jest, not in Metro. */
const nodeAndJestGlobals = {
  __dirname: "readonly",
  __filename: "readonly",
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  console: "readonly",
  jest: "readonly",
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/*",
      ".expo/*",
      // Generated native projects (expo prebuild) — not hand-written source.
      "android/*",
      "ios/*",
      // A Metro bundle dumped while debugging the duplicate react-native issue (ADAPTERS §16).
      "p2bundle.js",
    ],
  },
  {
    files: [
      "*.config.js",
      "jest.setup.js",
      "jest.resolver.js",
      "scripts/**/*.js",
      "plugins/**/*.js",
    ],
    languageOptions: { globals: nodeAndJestGlobals },
  },
  {
    // A verbatim port of web's services/api.ts. Keeping web's `Array<T>` spelling keeps the two
    // files diffable when a service changes on one side.
    files: ["src/services/api.ts"],
    rules: { "@typescript-eslint/array-type": "off" },
  },
  {
    // React Compiler rules. The compiler is NOT enabled in this app (no babel-plugin-react-compiler,
    // no `experiments.reactCompiler` in app.json), so these report code the compiler would skip or
    // could mis-handle — not bugs in the app as it runs today. `immutability`, for instance, flags
    // Reanimated's documented `sharedValue.value = …` writes inside gesture callbacks. They stay
    // visible as warnings, as the backlog for adopting the compiler, instead of failing lint on
    // patterns that are correct without it.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
]);
