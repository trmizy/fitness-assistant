const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo: watch the whole workspace so edits to backend/shared (and any
// future shared package) trigger a Metro refresh, not just apps/mobile.
config.watchFolders = [workspaceRoot];

// pnpm hoists most deps to the workspace root node_modules — make sure
// Metro looks there too, in addition to the local apps/mobile/node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm uses symlinks for workspace packages (backend/shared, etc.) —
// Metro must follow them instead of treating them as opaque node_modules.
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
