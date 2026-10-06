import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs } from "expo-router";
import type { LucideIcon } from "lucide-react-native";

import { darkColors, designTokens } from "../../theme/colors";
import {
  WorkspaceProvider,
  workspaceAccents,
  workspaceVars,
  type Workspace,
} from "../../theme/workspace";
import { hiddenRouteOptions } from "./hiddenRouteOptions";

export type WorkspaceTab = {
  /** Route file name inside the workspace folder, e.g. "dashboard". */
  name: string;
  label: string;
  icon: LucideIcon;
};

/**
 * The bottom tab bar, identical in shape for all four workspaces — only the tabs and the accent
 * differ. Keeping it in one place is what makes the design's "one component set, four actors" idea
 * hold: a change to tab-bar height or the active colour rule happens once.
 *
 * Wrapping in the workspace theme here (rather than in each `_layout`) means every screen under
 * the tabs inherits the right accent automatically — a PT screen is violet without knowing it is.
 */
export function WorkspaceTabs({
  workspace,
  tabs,
  hiddenRoutes = [],
  fullScreenRoutes = [],
}: {
  workspace: Workspace;
  tabs: WorkspaceTab[];
  /**
   * Route files that live in this folder but must NOT get a tab — expo-router registers every file
   * under a Tabs layout, so a screen like `client/onboarding` would otherwise appear as a sixth
   * tab. `href: null` keeps it reachable by navigation while leaving it off the bar.
   */
  hiddenRoutes?: string[];
  /**
   * Hidden routes that must also hide the tab BAR itself. `href: null` only removes the button;
   * the bar still renders under the screen. A gate like `client/onboarding` must not show tabs
   * into parts of the app the user is not set up for yet (RequireOnboarding would just bounce them
   * back), so those routes are listed here as well.
   */
  fullScreenRoutes?: string[];
}) {
  const accent = workspaceAccents[workspace];
  const insets = useSafeAreaInsets();

  return (
    <WorkspaceProvider value={workspace}>
      <View className="flex-1 bg-background" style={workspaceVars[workspace]}>
        <Tabs
            // Back returns to the tab the user came from. The default ("firstRoute") sent Back from
            // any screen opened out of another tab — the roadmap wizard from "Tập luyện" — to the
            // first tab instead (real phone, 6/10).
            backBehavior="history"
            screenOptions={{
              headerShown: false,
              // The root KeyboardAvoidingView shrinks the app above the keyboard; without this the
              // tab bar would ride up with it and eat the space a composer or form field needs.
              tabBarHideOnKeyboard: true,
              tabBarActiveTintColor: accent.primary,
              tabBarInactiveTintColor: designTokens.mutedForeground,
              tabBarStyle: {
                backgroundColor: darkColors.card,
                borderTopColor: darkColors.border,
                // RN's default is a hairline that reads as a smudge on a dark background.
                borderTopWidth: 1,
                // A fixed height replaces React Navigation's own inset handling, so the system bar
                // inset is added back by hand: the app is edge-to-edge, and on a phone with 3-button
                // navigation those buttons drew over the tabs (Galaxy S21 FE, 6/10). AiCoachFab sits
                // at insets.bottom + 62 + 20 and relies on this.
                height: 62 + insets.bottom,
                paddingTop: 6,
                paddingBottom: 8 + insets.bottom,
              },
              tabBarLabelStyle: {
                fontFamily: "Inter_500Medium",
                fontSize: 11,
              },
              // Long Vietnamese labels ("Trò chuyện") would otherwise wrap onto two lines.
              tabBarItemStyle: { paddingHorizontal: 2 },
            }}
          >
          {tabs.map((tab) => (
            <Tabs.Screen
              key={tab.name}
              name={tab.name}
              options={{
                title: tab.label,
                tabBarIcon: ({ color, focused }) => (
                  <tab.icon size={22} color={color} strokeWidth={focused ? 2.5 : 2} />
                ),
              }}
            />
          ))}

          {hiddenRoutes.map((name) => (
            <Tabs.Screen key={name} name={name} options={hiddenRouteOptions(name, fullScreenRoutes)} />
          ))}
        </Tabs>
      </View>
    </WorkspaceProvider>
  );
}
