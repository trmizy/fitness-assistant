import { View } from "react-native";
import { Tabs } from "expo-router";
import type { LucideIcon } from "lucide-react-native";

import { darkColors, designTokens } from "../../theme/colors";
import {
  WorkspaceProvider,
  workspaceAccents,
  workspaceVars,
  type Workspace,
} from "../../theme/workspace";

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
}: {
  workspace: Workspace;
  tabs: WorkspaceTab[];
  /**
   * Route files that live in this folder but must NOT get a tab — expo-router registers every file
   * under a Tabs layout, so a screen like `client/onboarding` would otherwise appear as a sixth
   * tab. `href: null` keeps it reachable by navigation while leaving it off the bar.
   */
  hiddenRoutes?: string[];
}) {
  const accent = workspaceAccents[workspace];

  return (
    <WorkspaceProvider value={workspace}>
      <View className="flex-1 bg-background" style={workspaceVars[workspace]}>
        <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: accent.primary,
              tabBarInactiveTintColor: designTokens.mutedForeground,
              tabBarStyle: {
                backgroundColor: darkColors.card,
                borderTopColor: darkColors.border,
                // RN's default is a hairline that reads as a smudge on a dark background.
                borderTopWidth: 1,
                height: 62,
                paddingTop: 6,
                paddingBottom: 8,
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
            <Tabs.Screen key={name} name={name} options={{ href: null }} />
          ))}
        </Tabs>
      </View>
    </WorkspaceProvider>
  );
}
