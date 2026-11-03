import { findingLabel, outcomeLabel } from "../../disputeCaseLabels";
import { formatDateTime, shortRef } from "../format";
import { FindingsActionsSlot, type ActionSlotProps } from "../actionSlots";
import { FINDING_TABLE_CAPTION, blockedText, findingTable, latestFinding, outcomeConsequence } from "../workspaceModel";
import { CARD, EmptyBox, Muted, Notice, Pill, Section } from "../WorkspaceParts";

const GRID = "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,2fr)]";
const CELL_LABEL = "text-[11px] font-medium text-adm-text-2 md:hidden";

export function FindingsTab({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const findings = [...(detail.findings ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = latestFinding(detail.findings);
  const proposals = [...(detail.proposals ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const rows = findingTable();

  return (
    <div className="space-y-4" data-testid="d2-tab-findings">
      <Section title="Kết luận mới nhất" testId="d2-latest-finding">
        {newest ? (
          <div className="space-y-1 text-sm">
            <Pill tone="info">{findingLabel(newest.finding)}</Pill>
            <p className="whitespace-pre-wrap break-words text-adm-text">{newest.reasoning}</p>
            <p className="text-xs text-adm-text-2">
              Ghi bởi mã {shortRef(newest.recordedBy)} · {formatDateTime(newest.createdAt)}
            </p>
          </div>
        ) : (
          <EmptyBox testId="d2-findings-empty">Hồ sơ chưa có kết luận.</EmptyBox>
        )}
        {findings.length > 1 && (
          <details className="rounded-lg border border-adm-border-soft" data-testid="d2-finding-history">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-adm-text-2">Các kết luận trước ({findings.length - 1})</summary>
            <ul className="space-y-2 px-3 pb-3 text-sm">
              {findings.slice(1).map((f) => (
                <li key={f.id}>
                  <span className="font-medium text-adm-text">{findingLabel(f.finding)}</span>
                  <span className="text-xs text-adm-text-2"> · {formatDateTime(f.createdAt)}</span>
                  <p className="whitespace-pre-wrap break-words text-adm-text">{f.reasoning}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title={`Đề xuất (${proposals.length})`} testId="d2-proposals">
        {proposals.length === 0 ? (
          <Muted>Chưa có đề xuất nào. Đề xuất chỉ lập được sau khi có kết luận cho phép một kết quả.</Muted>
        ) : (
          <ul className="space-y-2">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm" data-testid="d2-proposal">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="info">{outcomeLabel(p.outcome)}</Pill>
                  <span className="text-xs text-adm-text-2">
                    Lập bởi mã {shortRef(p.proposerId)} · {formatDateTime(p.createdAt)}
                  </span>
                </div>
                <p className="mt-1 break-words text-adm-text">{outcomeConsequence(p.outcome)}</p>
                {p.executionBlockedReason && (
                  <div className="mt-2">
                    <Notice tone="warning" testId="d2-proposal-blocked">
                      {blockedText(p.executionBlockedReason, detail.decision?.proposalId === p.id)}
                    </Notice>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <section className="space-y-2" aria-labelledby="d2-ft-title" data-testid="d2-finding-table">
        <div>
          <h3 id="d2-ft-title" className="text-sm font-semibold text-adm-text">
            Kết luận, kết quả và hệ quả
          </h3>
          <p className="text-xs text-adm-text-2" data-testid="d2-finding-table-caption">
            {FINDING_TABLE_CAPTION}
          </p>
        </div>
        <div role="table" aria-label="Kết luận, kết quả và hệ quả (minh hoạ, máy chủ tính lại)" className={`${CARD} overflow-hidden`}>
          <div role="row" className={`hidden gap-x-4 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 md:grid ${GRID}`}>
            <div role="columnheader">Kết luận</div>
            <div role="columnheader">Kết quả</div>
            <div role="columnheader">Hệ quả</div>
          </div>
          <div role="rowgroup">
            {rows.map((r) => (
              <div key={r.finding} role="row" className={`grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-adm-border-soft px-4 py-3 text-sm first:border-t-0 md:items-start ${GRID}`}>
                <div role="cell">
                  <p className={CELL_LABEL}>Kết luận</p>
                  <p className="font-medium text-adm-text">{r.findingLabel}</p>
                </div>
                <div role="cell">
                  <p className={CELL_LABEL}>Kết quả</p>
                  <p className="text-adm-text">{r.outcomeLabel}</p>
                </div>
                <div role="cell">
                  <p className={CELL_LABEL}>Hệ quả</p>
                  <p className="break-words text-adm-text">{r.consequence}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FindingsActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} />
    </div>
  );
}
