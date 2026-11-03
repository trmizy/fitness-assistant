import { partyRoleLabel } from "../../disputeCaseLabels";
import { formatDateTime } from "../format";
import { StatementsActionsSlot, type ActionSlotProps } from "../actionSlots";
import { statementSourceText, statementThreads } from "../workspaceModel";
import { CARD, EmptyBox, Muted, Pill } from "../WorkspaceParts";

export function StatementsTab({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const threads = statementThreads(detail.statements);
  const stmtShares = (detail.shares ?? []).filter((s) => s.statementId);
  return (
    <div className="space-y-4" data-testid="d2-tab-statements">
      <Muted>Lời khai được xếp theo từng bên và từng phiên bản. Phiên bản 1 lấy từ hai trường văn bản cũ của buổi tập.</Muted>
      <StatementsActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} />
      {threads.length === 0 ? (
        <EmptyBox testId="d2-statements-empty">Chưa có lời khai nào trong hồ sơ.</EmptyBox>
      ) : (
        threads.map((t) => (
          <section key={t.partyRole} className="space-y-2" data-testid="d2-statement-thread" aria-label={`Lời khai của ${partyRoleLabel(t.partyRole)}`}>
            <h3 className="text-sm font-semibold text-adm-text">{partyRoleLabel(t.partyRole)}</h3>
            {t.versions.map((s, i) => (
              <article key={s.id} className={`${CARD} p-4 ${i > 0 ? "opacity-90" : ""}`} data-testid="d2-statement">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={i === 0 ? "info" : "neutral"}>{i === 0 ? "Phiên bản mới nhất" : "Phiên bản trước"}</Pill>
                  <span className="text-xs text-adm-text-2">
                    {statementSourceText(s)} · {formatDateTime(s.createdAt)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-adm-text">{s.text}</p>
                {s.supplementReason && (
                  <p className="mt-2 text-xs text-adm-text-2">
                    <span className="font-medium">Lý do bổ sung:</span> {s.supplementReason}
                  </p>
                )}
              </article>
            ))}
          </section>
        ))
      )}
      {stmtShares.length > 0 && (
        <section className="space-y-1" data-testid="d2-statement-shares">
          <h3 className="text-sm font-semibold text-adm-text">Đã chia sẻ cho bên kia</h3>
          <ul className="space-y-1 text-xs text-adm-text">
            {stmtShares.map((s) => (
              <li key={s.id}>
                Chia sẻ cho {partyRoleLabel(s.sharedWithRole)} lúc {formatDateTime(s.createdAt)}: {s.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

