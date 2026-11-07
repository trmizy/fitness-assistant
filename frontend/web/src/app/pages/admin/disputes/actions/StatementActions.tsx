/** D3 - Statements slot: share a statement with one party (A18, investigator). Exactly one of statementId / evidenceId is sent. */
import type { ActionSlotProps } from "../workspace/actionSlots";
import { ActionGroup, MutedLine } from "./actionKit";
import { availability, investigatorOnlyLine, statementChoices } from "./actionModel";
import { SHARE_STATEMENT_NONE } from "./actionText";
import { ShareForm } from "./ShareForm";


export function StatementActions({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const a = availability(detail, currentUserId);
  if (!a.signedIn || a.terminal) return null;
  const line = investigatorOnlyLine(detail, currentUserId);
  return (
    <ActionGroup title="Thao tác với lời khai" testId="d3-actions-statements">
      {line && <MutedLine testId="d3-who-may-act">{line}</MutedLine>}
      {a.share && (
        <ShareForm
          kind="statement"
          caseId={detail.case.id}
          choices={statementChoices(detail.statements)}
          emptyText={SHARE_STATEMENT_NONE}
          onChanged={onChanged}
          testId="d3-share-statement"
          title="Chia sẻ lời khai cho một bên"
          caption="Bên nhận sẽ đọc được lời khai này. Không thu hồi được."
          pickLabel="Lời khai cần chia sẻ"
        />
      )}
    </ActionGroup>
  );
}
