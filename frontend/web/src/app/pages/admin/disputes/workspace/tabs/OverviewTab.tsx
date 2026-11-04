import { useQuery } from "@tanstack/react-query";
import { disputeCaseApi } from "../../disputeCaseApi";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "../../disputeQueryKeys";
import { caseStatusLabel, caseStatusText, caseTypeLabel, claimMoveLabel, claimantRoleLabel, ptLateFindingLabel, PT_LATE_ISSUE_NOTE } from "../../disputeCaseLabels";
import { investigatorText } from "../../queue/queueModel";
import { describePayload } from "../evidenceModel";
import { formatDateTime, proseOrNull } from "../format";
import { OverviewActionsSlot, type ActionSlotProps } from "../actionSlots";
import { AWAITING_PARTIES_NOTE, eventActor, eventLabel, eventNote, latestEvidenceOfSubject, sortedEvents, statusTone, stuckState, type WorkspaceTab } from "../workspaceModel";
import { EmptyBox, FieldList, Muted, Notice, Pill, Section } from "../WorkspaceParts";

const CONTRACT_LABELS = ["Tên gói", "Trạng thái hợp đồng", "Hình thức", "Tổng số buổi", "Đã dùng"];

export function OverviewTab({ detail, currentUserId, onChanged, onGoTab }: ActionSlotProps & { onGoTab: (tab: WorkspaceTab) => void }) {
  const c = detail.case;
  const { keys } = useDisputeQueryKeys();
  const sessionQuery = useQuery({
    queryKey: keys ? [...keys.all, "admin-session", c.sessionId] : ["dispute-case", "disabled", "admin-session"],
    queryFn: () => disputeCaseApi.getAdminSession(c.sessionId),
    enabled: !!keys,
    ...DISPUTE_QUERY_OPTIONS,
  });
  const accessQuery = useQuery({
    queryKey: keys ? [...keys.all, "access-log", c.id] : ["dispute-case", "disabled", "access-log"],
    queryFn: () => disputeCaseApi.getAccessLog(c.id, { limit: 20 }),
    enabled: !!keys,
    ...DISPUTE_QUERY_OPTIONS,
  });
  const stuck = stuckState(detail);
  const sessionRow = latestEvidenceOfSubject(detail.evidence, "SESSION_ROW");
  const contractRow = latestEvidenceOfSubject(detail.evidence, "CONTRACT_SNAPSHOT");
  const sessionFields = sessionRow ? describePayload(sessionRow).fields : [];
  const contractFields = contractRow ? describePayload(contractRow).fields.filter((f) => CONTRACT_LABELS.includes(f.label)) : [];
  const events = sortedEvents(detail.events).slice(0, 5);
  const claims = detail.claims ?? [];
  const issues = detail.issues ?? [];

  return (
    <div className="space-y-4" data-testid="d2-tab-overview">
      {stuck && (
        <Notice tone="warning" testId="d2-stuck" role="note">
          <p className="font-semibold">{stuck.title}</p>
          <p className="mt-1">{stuck.body}</p>
          <p className="mt-1 font-medium">{stuck.owner}</p>
        </Notice>
      )}
      {c.status === "AWAITING_PARTIES" && (
        <Notice tone="info" testId="d2-awaiting-parties">
          {AWAITING_PARTIES_NOTE}
        </Notice>
      )}

      <Section title="Hồ sơ" testId="d2-case-facts">
        <FieldList
          fields={[
            { label: "Loại khiếu nại", value: caseTypeLabel(c.type) },
            { label: "Trạng thái", value: caseStatusText(c) },
            { label: "Khách hàng", value: c.clientName ?? "Chưa có tên hiển thị" },
            { label: "Huấn luyện viên", value: c.ptName ?? "Chưa có tên hiển thị" },
            { label: "Người phụ trách", value: c.investigatorId === currentUserId ? "Bạn phụ trách" : c.investigatorId ? (c.investigatorName ?? "Chưa có tên hiển thị") : investigatorText(null, currentUserId) },
            { label: "Mở lúc", value: formatDateTime(c.createdAt) },
            { label: "Cập nhật lần cuối", value: formatDateTime(c.updatedAt) },
          ]}
        />
      </Section>

      <Section title="Buổi tập bị khiếu nại" testId="d2-session-summary">
        {sessionQuery.data && <FieldList fields={[
          { label: "Giờ bắt đầu", value: formatDateTime(sessionQuery.data.session.scheduledStartAt) },
          { label: "Giờ kết thúc", value: formatDateTime(sessionQuery.data.session.scheduledEndAt) },
          { label: "Khách", value: sessionQuery.data.session.clientName ?? "Chưa có tên hiển thị" },
          { label: "PT", value: sessionQuery.data.session.ptName ?? "Chưa có tên hiển thị" },
          { label: "Gói", value: sessionQuery.data.contract?.packageName ?? "Chưa có tên gói" },
        ]} />}
        {sessionQuery.isError && <Muted>Chưa đọc được chi tiết buổi tập. Bạn có thể tải lại hồ sơ để thử lại.</Muted>}
        {sessionFields.length > 0 || contractFields.length > 0 ? (
          <>
            <FieldList fields={sessionFields} />
            {contractFields.length > 0 && (
              <>
                <p className="pt-1 text-xs font-semibold text-adm-text-2">Hợp đồng</p>
                <FieldList fields={contractFields} />
              </>
            )}
          </>
        ) : (
          <Muted>Hồ sơ chưa có bản chụp thông tin buổi tập. Thông tin chi tiết của buổi chưa đọc được từ nơi khác.</Muted>
        )}
      </Section>

      <Section title="Nhật ký truy cập" testId="d5-access-log">
        {accessQuery.isLoading ? <Muted>Đang tải nhật ký truy cập…</Muted> : accessQuery.isError ? <Muted>Chưa đọc được nhật ký truy cập.</Muted> : !accessQuery.data?.items.length ? <Muted>Chưa có lượt truy cập được ghi nhận.</Muted> : (
          <ul className="space-y-2 text-sm text-adm-text">
            {accessQuery.data.items.map((a) => <li key={a.id} className="border-b border-adm-border-soft pb-2">
              {a.viewerName ?? "Quản trị viên"} · {a.action === "VIEW_EVIDENCE" ? "Xem bằng chứng" : "Xem hồ sơ"} · {formatDateTime(a.createdAt)}
            </li>)}
          </ul>
        )}
      </Section>

      <Section title={`Khẳng định (${claims.length})`} testId="d2-claims">
        {claims.length === 0 ? (
          <Muted>Chưa có khẳng định nào trong hồ sơ.</Muted>
        ) : (
          <ul className="space-y-2">
            {claims.map((cl) => (
              <li key={cl.id} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-adm-text">{claimantRoleLabel(cl.claimantRole)}</span>
                  {(cl.moves ?? []).map((m) => (
                    <Pill key={m} tone="neutral">
                      {claimMoveLabel(m)}
                    </Pill>
                  ))}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-adm-text">{cl.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Vấn đề đã ghi (${issues.length})`} testId="d2-issues">
        {issues.length === 0 ? (
          <Muted>Chưa ghi nhận vấn đề nào.</Muted>
        ) : (
          <>
            <ul className="space-y-2">
              {issues.map((i) => (
                <li key={i.id} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm">
                  <p className="font-medium text-adm-text">{ptLateFindingLabel(i.finding)}</p>
                  {proseOrNull(i.note) && <p className="mt-1 whitespace-pre-wrap break-words text-adm-text">{i.note}</p>}
                  <p className="mt-1 text-xs text-adm-text-2">{formatDateTime(i.createdAt)}</p>
                </li>
              ))}
            </ul>
            <Muted>{PT_LATE_ISSUE_NOTE}</Muted>
          </>
        )}
      </Section>

      <Section
        title="Diễn biến gần đây"
        testId="d2-timeline"
        aside={
          <button type="button" onClick={() => onGoTab("history")} className="min-h-11 rounded-md px-2 text-xs font-medium text-adm-text underline underline-offset-2 xl:min-h-0" data-testid="d2-timeline-all">
            Xem tất cả
          </button>
        }
      >
        {events.length === 0 ? (
          <EmptyBox>Chưa có sự kiện nào.</EmptyBox>
        ) : (
          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-adm-text">{eventLabel(e.action)}</span>
                  {e.toStatus && <Pill tone={statusTone(e.toStatus)}>{caseStatusLabel(e.toStatus)}</Pill>}
                </div>
                <p className="text-xs text-adm-text-2">
                  {eventActor(e, currentUserId)} · {formatDateTime(e.createdAt)}
                </p>
                {eventNote(e) && <p className="mt-0.5 break-words text-xs text-adm-text">{eventNote(e)}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <OverviewActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} />
    </div>
  );
}
