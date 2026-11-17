import { MUTED, Panel, Pill } from "./PartyParts";
import type { PartyAppealStatusView } from "./partyModel";

/** N15B-02: the party's own appeal after it was sent - a visible "Đang xem xét lại" state and, once decided, the result. */
export function PartyAppealStatus({ view }: { view: PartyAppealStatusView }) {
  return (
    <Panel id="d4-appeal-status" title="Yêu cầu xem xét lại của bạn" testId="d4-appeal-status" aside={<Pill tone={view.tone} testId="d4-appeal-badge">{view.badge}</Pill>}>
      <div role="status" className="space-y-1.5">
        <p className="text-sm font-semibold">{view.headline}</p>
        <p className={`text-sm ${MUTED}`}>{view.detail}</p>
        {view.when && <p className={`text-xs ${MUTED}`}>{view.when}</p>}
      </div>
    </Panel>
  );
}
