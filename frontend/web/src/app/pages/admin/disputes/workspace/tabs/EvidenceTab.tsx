import { useId } from "react";
import type { DisputeEvidence, DisputeShare } from "../../disputeCaseTypes";
import { GYM_CHECKIN_NOTE, partyRoleLabel } from "../../disputeCaseLabels";
import {
  GYM_CHECKIN_SUBJECTS,
  VIEW_LOGGED_NOTE,
  buildEvidenceGroups,
  describePayload,
  evidenceBadges,
  isUnreadable,
  provenanceText,
  type EvidenceItem,
  type PayloadView,
} from "../evidenceModel";
import { formatDateTime, formatSpan } from "../format";
import { EvidenceActionsSlot, type ActionSlotProps } from "../actionSlots";
import { CARD, EmptyBox, FieldList, Muted, Notice, Pill } from "../WorkspaceParts";

function PayloadBlock({ view, showGymNote }: { view: PayloadView; showGymNote: boolean }) {
  const notProven = view.notProven ?? (showGymNote ? GYM_CHECKIN_NOTE : null);
  return (
    <div className="space-y-3" data-testid="d2-payload">
      {notProven && (
        <Notice tone="warning" testId="d2-not-proven">
          {notProven}
        </Notice>
      )}
      <FieldList fields={view.fields} />
      {view.groups.map((g) => (
        <div key={g.title} className="space-y-2">
          <p className="text-xs font-semibold text-adm-text-2">
            {g.title} ({g.records.length})
          </p>
          {g.records.length === 0 ? (
            <p className="text-sm text-adm-text">{g.emptyText ?? "Không có dòng nào."}</p>
          ) : (
            <ul className="space-y-2">
              {g.records.map((rec, i) => (
                <li key={i} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3">
                  <FieldList fields={rec} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {view.notes.map((n, i) => (
        <Muted key={i}>{n}</Muted>
      ))}
      {view.technical.length > 0 && (
        <details className="rounded-lg border border-adm-border-soft" data-testid="d2-technical">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-adm-text-2">Chi tiết kỹ thuật ({view.technical.length})</summary>
          <dl className="space-y-1.5 px-3 pb-3 text-xs">
            {view.technical.map((f, i) => (
              <div key={`${f.label}-${i}`} className="min-w-0">
                <dt className="text-adm-text-2">{f.label}</dt>
                <dd className="break-all font-mono text-adm-text">{f.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function Times({ e }: { e: DisputeEvidence }) {
  const gap = e.eventAt ? formatSpan(e.eventAt, e.capturedAt) : null;
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 text-xs" data-testid="d2-evidence-times">
        <div className="min-w-0">
          <dt className="text-adm-text-2">Thời điểm xảy ra</dt>
          <dd className="font-medium text-adm-text" data-testid="d2-event-at">
            {e.eventAt ? formatDateTime(e.eventAt) : "Không có mốc"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-adm-text-2">Thời điểm hệ thống thu</dt>
          <dd className="font-medium text-adm-text" data-testid="d2-captured-at">
            {formatDateTime(e.capturedAt)}
          </dd>
        </div>
      </dl>
      {gap && <p className="mt-1 text-xs text-adm-text-2">Hai mốc cách nhau {gap}.</p>}
    </div>
  );
}

function EvidenceCard({ item, shares }: { item: EvidenceItem; shares: DisputeShare[] }) {
  const e = item.current;
  const badges = evidenceBadges(e);
  const unreadable = isUnreadable(e);
  const view = describePayload(e);
  const gymNote = GYM_CHECKIN_SUBJECTS.includes(e.subject) && !unreadable && e.captureStatus === "OK";
  return (
    <li className={`${CARD} space-y-3 p-4`} data-testid="d2-evidence-card" data-subject-kind={unreadable ? "unreadable" : "ok"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 text-sm font-semibold text-adm-text">{item.title}</h4>
        <span className="text-xs text-adm-text-2">
          Phiên bản {e.snapshotVersion}
          {e.supersedesId ? " · thay phiên bản trước" : ""}
        </span>
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <Pill key={b.label} tone={b.tone}>
              {b.label}
            </Pill>
          ))}
        </div>
      )}
      <p className="text-xs text-adm-text-2" data-testid="d2-provenance">
        {provenanceText(e)}
      </p>
      <Times e={e} />
      <PayloadBlock view={view} showGymNote={gymNote} />
      {shares.length > 0 && (
        <p className="text-xs text-adm-text-2" data-testid="d2-shared-note">
          Đã chia sẻ cho: {shares.map((s) => partyRoleLabel(s.sharedWithRole)).join(", ")}.
        </p>
      )}
      {item.older.length > 0 && (
        <details className="rounded-lg border border-adm-border-soft" data-testid="d2-versions">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-adm-text-2">Các phiên bản trước ({item.older.length})</summary>
          <ul className="space-y-1.5 px-3 pb-3 text-xs text-adm-text">
            {item.older.map((o) => (
              <li key={o.id}>
                Phiên bản {o.snapshotVersion}, thu lúc {formatDateTime(o.capturedAt)}
                {o.supersedesId ? ", thay một phiên bản trước nữa" : ", phiên bản đầu"}; đã được phiên bản sau thay thế.
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function EvidenceTab({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const id = useId();
  const groups = buildEvidenceGroups(detail.evidence);
  const sharesOf = (item: EvidenceItem) => {
    const ids = new Set([item.current.id, ...item.older.map((o) => o.id)]);
    return (detail.shares ?? []).filter((s) => s.evidenceId && ids.has(s.evidenceId));
  };
  return (
    <div className="space-y-4" data-testid="d2-tab-evidence">
      <Muted testId="d2-view-logged">{VIEW_LOGGED_NOTE} Số bằng chứng: {detail.evidence?.length ?? 0}.</Muted>
      <EvidenceActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} />
      {groups.length === 0 ? (
        <EmptyBox testId="d2-evidence-empty">Hồ sơ chưa có bằng chứng nào.</EmptyBox>
      ) : (
        groups.map((g, gi) => (
          <section key={g.source} aria-labelledby={`${id}-g${gi}`} className="space-y-2" data-testid="d2-evidence-group">
            <h3 id={`${id}-g${gi}`} className="text-sm font-semibold text-adm-text">
              {g.title}
            </h3>
            <ul className="space-y-3">
              {g.items.map((item) => (
                <EvidenceCard key={item.slotKey} item={item} shares={sharesOf(item)} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

