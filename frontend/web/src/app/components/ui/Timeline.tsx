import type { ElementType, ReactNode } from "react";
import { CircleIcon } from "@phosphor-icons/react";
import { cn } from "./utils";

export interface ActivityItemProps {
  icon?: ElementType;
  title: ReactNode;
  timestamp: string;
  actor?: string;
  detail?: ReactNode;
  /** Last item in the list — suppresses the connecting line below it. */
  isLast?: boolean;
}

/** One entry in a Timeline — an audit-log row, a status-change event, etc. */
export function ActivityItem({ icon: Icon = CircleIcon, title, timestamp, actor, detail, isLast }: ActivityItemProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
          <Icon className="size-3.5" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-zinc-800 mt-1" />}
      </div>
      <div className="pb-4 min-w-0">
        <p className="text-sm text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {timestamp}
          {actor && <> · {actor}</>}
        </p>
        {detail && <div className="mt-1 text-xs text-zinc-400">{detail}</div>}
      </div>
    </div>
  );
}

/** GYM_MANAGEMENT master spec §55 — shared audit/activity feed container ("Audit History"). */
export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("", className)}>{children}</div>;
}
