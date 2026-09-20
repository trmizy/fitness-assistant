/**
 * Jest resolver.
 *
 * react-native-worklets ships its own resolver whose job is to strip `.native` extensions for its
 * own files, so tests load the plain-JS implementation instead of the one that calls into a native
 * module that does not exist under Jest (without it, `setUpTests()` dies on
 * `workletsModuleProxy.loadUnpackers` at import time).
 *
 * It cannot be used directly here because it recognises its own files BY PACKAGE NAME, and this
 * project relocates the package to a short path (D:/.rnw) to survive Windows' MAX_PATH — by the
 * time a request reaches the resolver it no longer contains the string "react-native-worklets". So
 * the same rule is applied against the relocated directory as well.
 */
const { SHORTENED_PACKAGES } = require("./plugins/shortenPackagePaths");

const WORKLETS_DIR = SHORTENED_PACKAGES["react-native-worklets"];

function isWorklets(value) {
  if (!value) return false;
  const normalized = String(value).replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("react-native-worklets") ||
    (WORKLETS_DIR && normalized.includes(WORKLETS_DIR.toLowerCase()))
  );
}

module.exports = (request, options) => {
  if (isWorklets(request) || isWorklets(options.basedir)) {
    return options.defaultResolver(request, {
      ...options,
      extensions: options.extensions?.filter((ext) => !ext.includes("native")),
    });
  }

  return options.defaultResolver(request, options);
};
