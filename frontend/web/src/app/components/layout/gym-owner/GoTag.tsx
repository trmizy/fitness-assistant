/** Status tag = words + icon (never colour only). Tone comes from `branchStatusText` in scopeModel. */
import { CheckCircleIcon, ClockIcon, MinusCircleIcon, ProhibitIcon, WarningIcon, type Icon } from "@phosphor-icons/react";
import type { TagTone } from "../../../features/gym-owner/scope/scopeModel";

const ICON: Record<TagTone, Icon> = {
  ok: CheckCircleIcon,
  warn: WarningIcon,
  risk: ProhibitIcon,
  info: ClockIcon,
  neutral: MinusCircleIcon,
};

export function GoTag({ tone, text }: { tone: TagTone; text: string }) {
  const Icon = ICON[tone];
  return (
    <span className="go-tag" data-tone={tone}>
      <Icon aria-hidden="true" />
      {text}
    </span>
  );
}
