import { forwardRef } from "react";
import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps, IconWeight } from "@phosphor-icons/react";

/**
 * GYMINI ICON SYSTEM — Phosphor foundation.
 *
 * Phosphor (@phosphor-icons/react) is the single source of icon SHAPES for the whole app.
 * Nothing in this directory draws an SVG path — `createGyminiIcon` only ever wraps a real
 * Phosphor icon component and controls size/weight/tone/state, exactly as specced: brand
 * personality lives in color/weight/active-state/motion, never in a redrawn path.
 */
export type GyminiIconTone = "default" | "muted" | "accent" | "danger" | "success";
export type GyminiIconState = "default" | "active" | "disabled";

export interface GyminiIconProps extends Omit<PhosphorIconProps, "weight" | "color"> {
  size?: number | string;
  weight?: IconWeight;
  tone?: GyminiIconTone;
  /** `active` bumps weight to bold (unless `weight` is explicitly passed) and applies the
   * Gymini accent tone — the one place this system encodes its own opinion about state. */
  state?: GyminiIconState;
}

const TONE_CLASS: Record<GyminiIconTone, string> = {
  default: "",
  muted: "gymini-icon-muted",
  accent: "gymini-icon-accent",
  danger: "gymini-icon-danger",
  success: "gymini-icon-success",
};

/**
 * Wraps one Phosphor icon component. `phosphorIcon` is always a real, imported
 * `@phosphor-icons/react` component — this function never constructs or selects a shape, it
 * only forwards size/weight/tone/state onto whatever was passed in.
 */
export function createGyminiIcon(displayName: string, phosphorIcon: PhosphorIcon) {
  const PhosphorComponent = phosphorIcon;
  const Component = forwardRef<SVGSVGElement, GyminiIconProps>(
    ({ size = 24, weight, tone = "default", state = "default", className, ...props }, ref) => {
      const resolvedWeight: IconWeight = weight ?? (state === "active" ? "bold" : "regular");
      const resolvedTone: GyminiIconTone = state === "active" && tone === "default" ? "accent" : tone;
      return (
        <PhosphorComponent
          ref={ref}
          size={size}
          weight={resolvedWeight}
          className={`gymini-icon ${TONE_CLASS[resolvedTone]} ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
  );
  Component.displayName = displayName;
  return Component;
}
