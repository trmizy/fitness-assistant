const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo: watch ONLY apps/mobile + backend/shared (the one workspace
// package mobile actually imports source from, @gym-coach/shared) — NOT
// the whole workspaceRoot, and NOT even the root node_modules.
//
// Two things were tried and verified NOT to work (by actually running
// `expo start`, not by assumption) before landing here — see
// DECISIONS.md for the full story:
//   1. `watchFolders = [workspaceRoot]` (original) — crawler walks every
//      service's node_modules; on Windows those contain reparse points/
//      junctions (Prisma engine caches, Docker bind-mount artifacts)
//      that crash `lstat` with EACCES.
//   2. `resolver.blockList` to exclude those paths while still watching
//      workspaceRoot — still crashed. blockList only filters crawl
//      RESULTS after `lstat` already ran on every file; it can't skip a
//      path that dies during the raw walk itself.
//   3. Narrowing watchFolders to `[projectRoot, workspaceRoot/node_modules,
//      backend/shared]` — moved the crash into the root pnpm store
//      itself: broken reparse-point stubs for foreign-platform optional
//      native deps (e.g. `lightningcss-freebsd-x64`) are pervasive
//      throughout `node_modules/.pnpm` on this Windows machine, not just
//      in one place — same class of problem, just relocated.
//
// Root node_modules is therefore excluded from watchFolders entirely.
// Module RESOLUTION for hoisted deps still works via
// `resolver.nodeModulesPaths` below + `unstable_enableSymlinks` — pnpm
// symlinks packages directly into apps/mobile/node_modules, and Metro's
// resolver reads/follows those on demand at resolve time, which does NOT
// require the symlink target's directory to be part of the watched set.
config.watchFolders = [projectRoot, path.resolve(workspaceRoot, "backend/shared")];

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
