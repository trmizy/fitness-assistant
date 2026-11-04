/** D6 - execution and money of a gym case. `BUSINESS_DONE` is NOT "money arrived": the money line is read from the server's financial view only. */
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { execBlockedText } from "../gymCaseErrors";
import { GYM_EXEC_NOTE, MONEY_NOT_BANK, classHasMoneyExit, gymClosureLabel, gymExecLabel, gymOutcomeLabel, type Tone } from "../gymCaseLabels";
import { describeMoney, gatesOf } from "../gymCaseModel";
import { formatDateTimeSafe } from "../gymFormat";
import type { GymCaseDetail, GymExecStatus } from "../gymCaseTypes";
import { ExecuteCard, ReconcileCard, needsHumanText } from "../forms/ExecutionPanel";
import type { FormProps } from "../forms/formTypes";
import { Facts, Muted, Notice, Pill, Section } from "../GymParts";
import { GateLine, Group } from "../gymCaseKit";

const STATE_LABEL: Record<string, string> = {
  STARTED: "Bắt đầu thực thi",
  BLOCKED: "Bị chặn, chưa có tiền nào được chuyển",
  NEEDS_HUMAN: "Cần người xem xét",
  BUSINESS_DONE: "Bước nghiệp vụ đã trả lời",
};
const EXEC_TONE: Record<GymExecStatus, Tone> = { NOT_STARTED: "neutral", EXECUTING: "pending", BUSINESS_DONE: "success", EXEC_BLOCKED: "warning", NEEDS_HUMAN: "danger" };

export function ExecutionTab(props: FormProps & { onReload: () => void; reloading: boolean }) {
  const { detail, onReload, reloading } = props;
  const g = gatesOf(detail);
  const money = describeMoney(detail.financial);
  const st = detail.case.execStatus;
  const decision = detail.decision;
  const refund = !!decision && classHasMoneyExit(detail.case.caseClass) && decision.outcome.startsWith("REFUND_");
  return (
    <div className="space-y-4" data-testid="d6-tab-execution">
      <Section title="Thực thi" testId="d6-exec">
        <Facts
          items={[
            { label: "Quyết định đã duyệt", value: decision ? decision.outcomeLabel || gymOutcomeLabel(decision.outcome) : "Chưa có quyết định được duyệt" },
            { label: "Trạng thái thực thi", value: <Pill tone={EXEC_TONE[st] ?? "neutral"}>{gymExecLabel(st)}</Pill> },
            { label: "Tình trạng hồ sơ", value: gymClosureLabel(detail.closure) },
          ]}
        />
        <p className="text-sm text-adm-text" data-testid="d6-exec-note">
          {decision ? GYM_EXEC_NOTE[st] ?? "" : "Chưa có quyết định nào được duyệt nên chưa thực thi được."}
        </p>
        {st === "NEEDS_HUMAN" && (
          <Notice tone="warning" testId="d6-needs-human" role="note">
            Cần người xem xét. {needsHumanText(latestReason(detail))} Hệ thống không tự thử lại và không có nút thực thi lại.
          </Notice>
        )}
      </Section>

      <Section
        title="Tiền"
        testId="d6-money"
        aside={
          <Button type="button" variant="outline" size="sm" onClick={onReload} disabled={reloading} className="min-h-11 xl:min-h-8" data-testid="d6-money-reload">
            <ArrowClockwiseIcon aria-hidden /> Tải lại
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={money.tone}>{money.chip}</Pill>
        </div>
        <p className="break-words text-sm text-adm-text" data-testid="d6-money-sentence">
          {money.sentence}
        </p>
        <Facts
          items={[
            ...(money.posted ? [{ label: "Đã ghi vào ví Gymini của hội viên", value: money.posted }] : []),
            ...(money.shortfall ? [{ label: "Còn thiếu của hội viên (chưa trả)", value: money.shortfall }] : []),
            ...(money.platformShortfall ? [{ label: "Thiếu ở phía nền tảng (thu hồi hoa hồng giới thiệu, không phải của hội viên)", value: money.platformShortfall }] : []),
          ]}
        />
        <Muted>{MONEY_NOT_BANK}</Muted>
        {refund && detail.financial.state === "NOT_EXECUTED" && <Muted>Hoàn tiền chỉ xảy ra khi bạn thực thi quyết định ở trên; duyệt thôi chưa chuyển tiền.</Muted>}
        {detail.financial.observedAt && <Muted>Đọc từ phản hồi của sổ cái lúc {formatDateTimeSafe(detail.financial.observedAt)}.</Muted>}
      </Section>

      {!g.writeOff && decision && (
        <Group title="Thao tác" testId="d6-actions-execution">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {g.execute.open && <ExecuteCard {...props} />}
            {g.reconcile.open && <ReconcileCard {...props} />}
          </div>
          {!g.execute.open && !g.reconcile.open && <GateLine why={g.execute.why} testId="d6-gate-execute" />}
        </Group>
      )}

      <Section title="Lịch sử thực thi" testId="d6-exec-history">
        {detail.execution.history.length === 0 ? (
          <p className="text-sm text-adm-text-2" data-testid="d6-exec-history-empty">
            Chưa có lần thực thi nào.
          </p>
        ) : (
          <ol className="space-y-2">
            {detail.execution.history.map((h) => (
              <li key={h.id} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm" data-testid="d6-exec-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-adm-text">
                    Lần {h.attempt || 1}: {STATE_LABEL[h.state] ?? "Bước khác"}
                  </span>
                  <span className="text-xs text-adm-text-2">{formatDateTimeSafe(h.createdAt)}</span>
                </div>
                {h.state === "BLOCKED" && <p className="mt-1 break-words text-adm-text-2">{execBlockedText(h.blockedReason)}</p>}
                {h.state === "NEEDS_HUMAN" && <p className="mt-1 break-words text-adm-text-2">{needsHumanText(h.blockedReason)}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function latestReason(d: GymCaseDetail): string | null {
  const h = [...d.execution.history].reverse().find((x) => x.state === "NEEDS_HUMAN");
  return h?.blockedReason ?? null;
}
