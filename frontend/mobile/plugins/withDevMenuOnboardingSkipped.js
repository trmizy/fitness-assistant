const { withAndroidManifest } = require("expo/config-plugins");

/**
 * expo-dev-menu's native menu-presentation code (the Fragment/Activity transition shared by both
 * the first-launch onboarding overlay and the regular bottom-sheet menu) deadlocks the UI thread
 * for ~15s on EVERY invocation on this project — reproduced identically via: the onboarding
 * "Continue" button, and the floating gear button (tapped twice, froze both times, ruling out a
 * one-time-only "first summon" quirk). Android reports it as a true ANR ("Input dispatching timed
 * out ... Waited 15000-15001ms for MotionEvent"), confirmed via low system load and reproduction
 * on a freshly-rebooted emulator — not slowness. This matches a known recurring class of bug in
 * expo-dev-menu's Android first-open code (see its CHANGELOG: "Fix error on summoning dev-menu
 * first time, that leads to the application freeze", from an old release) — this project's
 * instance appears to be a current, unfixed case of the same class, likely related to New
 * Architecture/Bridgeless.
 *
 * Root-causing/patching expo-dev-menu's native Kotlin transition code was not pursued further:
 * it's vendored third-party dev-only chrome, never shipped to production, so the pragmatic fix is
 * to remove every passive/visible on-screen trigger for it instead:
 *   - EXDevMenuIsOnboardingFinished=true — skip the onboarding overlay entirely.
 *   - EXDevMenuShowFloatingActionButton=false — hide the always-visible gear FAB, since it's the
 *     one trigger a normal tester could hit by accident during ordinary screen interaction.
 * Both are official `DevMenuPreferences.kt` config keys (metaDataBool-driven defaults), not a
 * hack. Shake gesture / 3-finger long-press / Ctrl+M still exist as deliberate opt-in ways for a
 * developer to open the dev menu and will still hit the same ~15s freeze (recoverable via the
 * system ANR dialog's "Wait") — that's an accepted, documented dev-workflow cost, not a blocker,
 * since it never surfaces during normal app usage or testing. Prefer Metro's own `r` (reload) CLI
 * keyboard shortcut or a full app relaunch over the on-device dev menu where possible.
 */
const FLAGS = {
  EXDevMenuIsOnboardingFinished: "true",
  EXDevMenuShowFloatingActionButton: "false",
};

function withDevMenuOnboardingSkipped(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    application["meta-data"] = application["meta-data"] || [];

    for (const [name, value] of Object.entries(FLAGS)) {
      const existing = application["meta-data"].find(
        (item) => item.$["android:name"] === name
      );
      if (existing) {
        existing.$["android:value"] = value;
      } else {
        application["meta-data"].push({
          $: { "android:name": name, "android:value": value },
        });
      }
    }

    return config;
  });
}

module.exports = withDevMenuOnboardingSkipped;
