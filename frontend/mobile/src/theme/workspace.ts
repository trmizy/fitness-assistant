import { createContext, useContext } from "react";
import { vars } from "nativewind";

// palette.js is CommonJS on purpose: tailwind.config.js reads the same file, and it cannot import TS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const palette = require("./palette") as {
  workspaceAccents: Record<
    Workspace,
    {
      primary: string;
      primaryDeep: string;
      onPrimary: string;
      chart1: string;
      chart2: string;
      chart3: string;
    }
  >;
};

/**
 * Which actor's colour the UI is wearing. The design re-themes the entire app per workspace by
 * overriding a few CSS variables on a wrapper element — green for the client, violet for the PT,
 * blue for a gym owner, teal for admin — so one component set serves all four with no per-actor
 * variants (see D:\New Frontend\src\index.css's `[data-workspace]` blocks).
 *
 * NativeWind's `vars()` is the same mechanism, so this ports 1:1: `workspaceVars[workspace]` goes
 * on a wrapper `style`, and every `bg-primary` / `text-primary` / `border-ring` / `text-chart-1`
 * below it resolves through the variable. Nothing has to know which workspace it is in.
 */
export type Workspace = "client" | "pt" | "gym" | "admin";

/**
 * Hex → the space-separated RGB channels Tailwind needs to be able to apply an opacity modifier
 * (`bg-primary/15`). See the matching note in tailwind.config.js — storing hex here instead makes
 * every `/opacity` class silently do nothing.
 */
function channels(hex: string): string {
  const value = hex.replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const int = parseInt(expanded, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

function toVars(accent: (typeof palette.workspaceAccents)[Workspace]) {
  return vars({
    "--color-primary": channels(accent.primary),
    "--color-primary-deep": channels(accent.primaryDeep),
    "--color-on-primary": channels(accent.onPrimary),
    "--color-chart-1": channels(accent.chart1),
    "--color-chart-2": channels(accent.chart2),
    "--color-chart-3": channels(accent.chart3),
  });
}

export const workspaceVars: Record<Workspace, ReturnType<typeof vars>> = {
  client: toVars(palette.workspaceAccents.client),
  pt: toVars(palette.workspaceAccents.pt),
  gym: toVars(palette.workspaceAccents.gym),
  admin: toVars(palette.workspaceAccents.admin),
};

/** The raw hex values, for the rare consumer that cannot go through a class name — an SVG stroke,
 *  a chart library prop, a native status-bar colour. */
export const workspaceAccents = palette.workspaceAccents;

const WorkspaceContext = createContext<Workspace>("client");

export const WorkspaceProvider = WorkspaceContext.Provider;

/** Read the current workspace. Prefer a `primary`-based class over this — the point of the
 *  variables is that components do not branch on the actor. */
export function useWorkspace(): Workspace {
  return useContext(WorkspaceContext);
}

export function useWorkspaceAccent() {
  return workspaceAccents[useWorkspace()];
}
