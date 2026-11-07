import { adminService } from "../../../../services/api";
import { AuthenticatedImage } from "../../../../components/ui/AuthenticatedImage";
import { Facts, Muted, Notice, Pill, Section, DisputeLink, FOCUS } from "../GymParts";
import { GYM_CLASS_HELP, gymClassLabel, gymClosureLabel, gymExecLabel, gymStatusLabel, gymWaitingNote, issueLabel, complaintStatusLabel, gymStatusTone, slaStatusLabel, slaStatusTone } from "../gymCaseLabels";
import { DeadlinesTable } from "../../disputes/workspace/DeadlinesTable";
import { COMPLAINTS_PATH, gatesOf, investigatorText, reporterText } from "../gymCaseModel";
import { formatDateSafe, formatDateTimeSafe } from "../gymFormat";
import { formatMoneyString } from "../../adminFinanceOverview.utils";
import type { GymCaseDetail } from "../gymCaseTypes";
import { AssignCard, RecollectCard, RejectIntakeCard, RequestMoreCard, TransitionCard } from "../forms/InvestigationForms";
import type { FormProps } from "../forms/formTypes";
import { GateLine, Group } from "../gymCaseKit";

const SOURCE: Record<string, string> = {
  SELF_DETECTED: "Admin tự phát hiện",
  MEMBER_REPORT: "Hội viên báo cáo",
  PT_REPORT: "PT phản ánh",
  PARTNER_DISCLOSED: "Đối tác tự khai báo",
};
const MEMBERSHIP_STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Chờ thanh toán",
  ACTIVE: "Đang hoạt động",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã huỷ",
  PENDING_ISSUE: "Có vấn đề thanh toán",
};

export function OverviewTab(props: FormProps & { detail: GymCaseDetail }) {
  const { detail, currentUserId } = props;
  const c = detail.case;
  const g = gatesOf(detail);
  const open = c.status !== "DECISION_APPROVED" && c.status !== "REJECTED_INTAKE";
  return (
    <div className="space-y-4" data-testid="d6-tab-overview">
      <Section title="Khiếu nại gốc" testId="d6-complaint">
        <Facts
          items={[
            { label: "Loại vấn đề", value: issueLabel(detail.complaint.issueType) },
            { label: "Nguồn", value: SOURCE[detail.complaint.source] ?? "Nguồn khác" },
            { label: "Phòng tập", value: detail.gym?.name ?? "Chưa đọc được tên phòng tập" },
            { label: "Người phản ánh", value: reporterText(detail.complaint.reporterUserId) },
            { label: "Tình trạng khiếu nại", value: complaintStatusLabel(detail.complaint.status) },
            { label: "Mở hồ sơ lúc", value: formatDateTimeSafe(c.createdAt) },
          ]}
        />
        <p className="whitespace-pre-wrap break-words text-sm text-adm-text" data-testid="d6-complaint-text">
          {detail.complaint.description}
        </p>
        {detail.complaint.photoTokens.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {detail.complaint.photoTokens.map((t) => (
              <AuthenticatedImage key={t} fetchBlob={() => adminService.fetchComplaintPhotoBlob(t)} alt="Ảnh minh chứng của khiếu nại" className="size-20" />
            ))}
          </div>
        )}
        {detail.complaint.adminResponse && (
          <p className="rounded-lg border border-adm-border-soft bg-adm-surface-2 px-3 py-2 text-sm text-adm-text">
            <span className="text-adm-text-2">Phản hồi đã gửi: </span>
            {detail.complaint.adminResponse}
          </p>
        )}
        <DisputeLink to={COMPLAINTS_PATH} className={`inline-flex min-h-11 items-center text-sm font-medium text-adm-text underline-offset-2 hover:underline xl:min-h-8 ${FOCUS}`}>
          Về danh sách khiếu nại
        </DisputeLink>
      </Section>

      <Section title="Hồ sơ xử lý" testId="d6-case-facts">
        <Facts
          items={[
            { label: "Loại hồ sơ", value: gymClassLabel(c.caseClass) },
            { label: "Bước hiện tại", value: <Pill tone={gymStatusTone(c.status)}>{gymStatusLabel(c.status)}</Pill> },
            { label: "Người phụ trách", value: investigatorText(c.investigatorId, currentUserId) },
            { label: "Thực thi", value: gymExecLabel(c.execStatus) },
            { label: "Tình trạng hồ sơ", value: gymClosureLabel(detail.closure) },
            ...(detail.sla
              ? [
                  {
                    label: "Thời gian xử lý",
                    value: (
                      <span className="flex items-center gap-2" data-testid="d6-sla">
                        <Pill tone={slaStatusTone(detail.sla.state)}>{slaStatusLabel(detail.sla.state)}</Pill>
                        <span className="text-xs text-adm-text-2">
                          {detail.sla.ageDays ?? detail.sla.daysOpen ?? 0} ngày lịch kể từ khi mở khiếu nại
                        </span>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
        <Muted>{GYM_CLASS_HELP[c.caseClass as keyof typeof GYM_CLASS_HELP] ?? ""}</Muted>
        <p className="text-sm text-adm-text" data-testid="d6-waiting-note">
          {gymWaitingNote(c.status, c.execStatus)}
        </p>
      </Section>

      <DeadlinesTable deadlines={detail.deadlines} />

      {detail.refundQuote && (
        <Section title="Định giá hoàn tiền" testId="d6-refund-quote">
          <Facts
            items={[
              { label: "Số tiền hoàn cố định", value: formatMoneyString(detail.refundQuote.amount) },
              { label: "Giá gốc", value: formatMoneyString(detail.refundQuote.pricePaid) },
              { label: "Chốt tại thời điểm", value: formatDateTimeSafe(detail.refundQuote.quotedAt) },
            ]}
          />
          <Muted>
            Số tiền hoàn được chốt theo ngày khiếu nại; máy chủ tính, không nhập tay.
          </Muted>
        </Section>
      )}

      {detail.membership && (
        <Section title="Gói hội viên liên quan" testId="d6-membership">
          <Facts
            items={[
              { label: "Tình trạng gói", value: MEMBERSHIP_STATUS[detail.membership.status] ?? "Chưa rõ" },
              { label: "Bắt đầu", value: formatDateSafe(detail.membership.startDate) },
              { label: "Kết thúc", value: formatDateSafe(detail.membership.endDate) },
              { label: "Giá lúc mua", value: detail.membership.priceAtPurchase },
            ]}
          />
          <Muted>Giá lúc mua không phải số tiền sẽ hoàn. Số hoàn do máy chủ tính khi thực thi.</Muted>
        </Section>
      )}

      {open && (
        <div className="space-y-4" data-testid="d6-actions-overview">
          <Group title="Thao tác" testId="d6-actions-group">
            {g.writeOff ? null : (
              <>
                {g.assign.open ? <AssignCard {...props} /> : <GateLine why={g.assign.why} testId="d6-gate-assign" />}
                {g.rejectIntake.open && <RejectIntakeCard {...props} />}
                {g.transition.open ? <TransitionCard {...props} /> : null}
                {g.requestMore.open ? <RequestMoreCard {...props} /> : null}
                {g.recollect.open ? <RecollectCard {...props} /> : null}
                {!g.transition.open && !g.requestMore.open && !g.recollect.open && <GateLine why={g.requestMore.why ?? g.recollect.why} testId="d6-gate-investigate" />}
              </>
            )}
          </Group>
        </div>
      )}
      {!open && (
        <Notice tone="info" testId="d6-terminal-note" role="note">
          Hồ sơ đã ở bước cuối nên không còn thao tác điều tra nào.
        </Notice>
      )}
    </div>
  );
}
