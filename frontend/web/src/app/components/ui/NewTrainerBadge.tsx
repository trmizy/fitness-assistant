import { NEW_TRAINER_DESCRIPTION, NEW_TRAINER_LABEL } from "../../utils/ptNewTrainer";

/** Same chip shape/colours as the other PT discovery badges (ONLINE / distance), wraps on 360 px. */
export function NewTrainerBadge({ className = "" }: { className?: string }) {
  return (
    <span
      data-testid="pt-new-trainer-badge"
      title={NEW_TRAINER_DESCRIPTION}
      className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/10 border-emerald-500/25 text-emerald-400 whitespace-nowrap ${className}`}
    >
      {NEW_TRAINER_LABEL}
      <span className="sr-only">. {NEW_TRAINER_DESCRIPTION}</span>
    </span>
  );
}
