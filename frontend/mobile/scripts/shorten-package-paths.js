#!/usr/bin/env node
/**
 * Standalone runner for the shortenPackagePaths logic — see
 * plugins/shortenPackagePaths.js for the full history/rationale.
 *
 * MUST run before `expo prebuild`, not as an Expo config plugin: Expo's own Android autolinking
 * config generation (settings.gradle / Android-autolinking.cmake, listing each native module's
 * absolute project directory) runs as part of prebuild's core Android scaffolding, BEFORE any
 * user config-plugin "dangerousMod" callback executes — confirmed by evidence: relinking via a
 * config plugin left autolinked paths pointing at the original long .pnpm location regardless
 * (`intermediates/cxx/.../prefab_command.bat` errors kept citing the pre-junction path). Running
 * this script first means node_modules/<pkg> is ALREADY a short-path junction by the time
 * `expo prebuild` computes and bakes in those absolute paths.
 *
 * Usage: `node scripts/shorten-package-paths.js` (run from frontend/mobile), then
 * `npx expo prebuild --platform android [--clean]`.
 */
const { shortenAllPackagePaths } = require("../plugins/shortenPackagePaths");

shortenAllPackagePaths(__dirname + "/..");
