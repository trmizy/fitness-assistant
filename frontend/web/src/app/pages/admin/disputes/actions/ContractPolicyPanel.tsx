import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { disputeCaseApi, type ContractPolicyInput } from "../disputeCaseApi";
import type { PolicyReviewResult } from "../disputeCaseTypes";
import { CONTRACT_POLICY_REF_KIND_LABEL, POLICY_RESULT_LABEL } from "../disputeCaseLabels";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "../disputeQueryKeys";
import { parseDisputeError } from "../disputeCaseErrors";
import { shortRef } from "../workspace/format";
import { describePolicyReviews } from "../workspace/policyModel";
import { CompactReference } from "../shared/CompactReference";
import { ApprovePolicyCard } from "./PolicyActions";
import { ActionButton, Check, ErrorBox, Field, FormCard, MutedLine, Select, TextArea, useWrite } from "./actionKit";

const GROUPS: Record<string, string> = {
  NEW_CURRENT_POLICY: "Cần rà soát chính sách hiện hành",
  HISTORICAL_NOTICE: "Hợp đồng cần rà soát lịch sử",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu để xác định chính sách",
  EXCEPTION_VERIFIED: "Đã xác lập ngoại lệ lịch sử",
};

/** A30–A32: a contract review has no dependency on opening a dispute case. */
export function ContractPolicyPanel({ contractId }: { contractId: string }) {
  const uid = useId();
  const { keys, userId } = useDisputeQueryKeys();

  const classification = useQuery({
    queryKey: [...(keys?.all ?? ["dispute-case", "disabled"]), "contract-policy-classification", contractId],
    enabled: !!keys,
    queryFn: () => disputeCaseApi.getContractPolicyClassification(contractId),
    ...DISPUTE_QUERY_OPTIONS,
  });

  const reviews = useQuery({
    queryKey: [...(keys?.all ?? ["dispute-case", "disabled"]), "contract-policy-reviews", contractId],
    enabled: !!keys,
    queryFn: () => disputeCaseApi.getContractPolicyReviews(contractId),
    ...DISPUTE_QUERY_OPTIONS,
  });

  const reload = async () => {
    const fresh = await Promise.all([classification.refetch(), reviews.refetch()]);
    if (fresh.some((r) => r.isError)) {
      throw new Error("Không tải lại được kết luận chính sách.");
    }
  };

  const w = useWrite<ContractPolicyInput, PolicyReviewResult>(reload);
  const [result, setResult] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [validation, setValidation] = useState("");

  const c = classification.data;
  const candidates: Array<{ kind: "PT_TERMS_ACCEPTANCE" | "CONTRACT_AUDIT_LOG"; id: string; label: string }> = [
    ...(c?.facts.ptAcceptances ?? [])
      .filter((a) => !a.isDraft)
      .map((a) => ({
        kind: "PT_TERMS_ACCEPTANCE" as const,
        id: a.id,
        label: `Điều khoản PT ${a.version} · ${shortRef(a.id)}`,
      })),
    ...(c?.facts.ptTermsAtAcceptance
      ? [
          {
            kind: "CONTRACT_AUDIT_LOG" as const,
            id: c.facts.ptTermsAtAcceptance.auditLogId,
            label: `Nhật ký gắn điều khoản ${c.facts.ptTermsAtAcceptance.version}`,
          },
        ]
      : []),
  ];

  const view = reviews.data
    ? describePolicyReviews({ policyReviews: reviews.data, evidence: [] }, [], userId)
    : null;

  // Single Map lookup for reviews items
  const reviewItemsById = new Map((reviews.data?.items ?? []).map((it) => [it.reviewId, it]));

  async function submit() {
    if (!result || !reasoning.trim() || reasoning.trim().length > 4000 || picked.length < 1 || picked.length > 20) {
      setValidation("Chọn kết luận, từ 1 đến 20 căn cứ và nhập lý do tối đa 4.000 ký tự.");
      return;
    }
    const body: ContractPolicyInput = {
      result: result as ContractPolicyInput["result"],
      reasoning: reasoning.trim(),
      evidenceRefs: candidates
        .filter((r) => picked.includes(`${r.kind}:${r.id}`))
        .map(({ kind, id }) => ({ kind, id })),
      ...(supersedes ? { supersedesId: supersedes } : {}),
    };
    if (!body.evidenceRefs.length) return;
    const answer = await w.submit(body, (key, b) => disputeCaseApi.proposeContractPolicy(contractId, b, key));
    if (answer.ok) {
      setPicked([]);
      setReasoning("");
      setResult("");
      setValidation("");
    }
  }

  return (
    <section className="space-y-3" data-testid="contract-policy-panel">
      <h3 className="font-semibold text-adm-text">Rà soát chính sách cấp hợp đồng</h3>
      <MutedLine>
        Phân loại chỉ hỗ trợ rà soát. Chỉ kết luận được quản trị viên thứ hai duyệt mới mở hoặc đóng quyền phán quyết của hợp đồng.
      </MutedLine>

      {(classification.isLoading || reviews.isLoading) && (
        <p role="status" className="text-sm text-adm-text-2">
          Đang tải căn cứ chính sách…
        </p>
      )}

      {(classification.error || reviews.error) && (
        <p role="alert" className="text-sm text-st-danger">
          {parseDisputeError(classification.error || reviews.error).message}
        </p>
      )}

      {c && (
        <div className="space-y-2 text-sm text-adm-text">
          <p className="font-medium">{GROUPS[c.group] ?? "Cần rà soát chính sách"}</p>
          <MutedLine>Chỉ để tham khảo, không mở quyền phán quyết.</MutedLine>
          <ul className="list-disc space-y-1 pl-5">
            {c.missing.map((m) => (
              <li key={m.code}>{m.message}</li>
            ))}
          </ul>
        </div>
      )}

      {view && (
        <>
          <p className="text-sm text-adm-text" data-testid="contract-policy-in-force">
            {view.forceLine}
          </p>
          <ul className="space-y-2">
            {view.rows.map((r) => {
              const item = reviewItemsById.get(r.id);
              const isMine = item?.proposedBy === userId;
              const isContractLevel = item?.level === "CONTRACT";

              return (
                <li key={r.id} className="space-y-2 rounded-lg border border-adm-border p-3 text-sm text-adm-text">
                  <p className="font-semibold">
                    {r.resultLabel} · {r.statusLabel}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{r.reasoning}</p>

                  {item?.evidenceRefs && item.evidenceRefs.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs font-semibold text-adm-text-2">Căn cứ chính sách:</p>
                      <ul className="space-y-1.5">
                        {item.evidenceRefs.map((ref) => (
                          <li key={`${ref.kind}:${ref.id}`} className="space-y-1 rounded border border-adm-border-soft bg-adm-surface p-2">
                            <span className="font-medium text-xs text-adm-text-2">
                              {CONTRACT_POLICY_REF_KIND_LABEL[ref.kind] ?? ref.kind}
                            </span>
                            <CompactReference value={ref.id} label="Mã căn cứ" />
                            {ref.hash && <CompactReference value={ref.hash} label="Mã băm" />}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {r.pending && isContractLevel && (
                    isMine ? (
                      <MutedLine>Bạn đã lập kết luận này. Cần một quản trị viên khác duyệt.</MutedLine>
                    ) : (
                      <ApprovePolicyCard contractId={contractId} review={r} onChanged={reload} />
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {c && (
        <FormCard title="Đề xuất kết luận cấp hợp đồng" testId="contract-policy-propose">
          <Field id={`${uid}-result`} label="Kết luận" required>
            <Select
              id={`${uid}-result`}
              value={result}
              onChange={(v) => {
                w.onEdit();
                setResult(v);
              }}
              placeholder="Chọn kết luận…"
              options={Object.entries(POLICY_RESULT_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-adm-text">
              Căn cứ được máy chủ tra cứu (bắt buộc)
            </legend>
            {candidates.map((r, i) => (
              <Check
                key={`${r.kind}:${r.id}`}
                id={`${uid}-ref-${i}`}
                checked={picked.includes(`${r.kind}:${r.id}`)}
                label={r.label}
                onChange={(on) => {
                  w.onEdit();
                  setPicked((old) => (on ? [...old, `${r.kind}:${r.id}`] : old.filter((v) => v !== `${r.kind}:${r.id}`)));
                }}
              />
            ))}
            {!candidates.length && (
              <MutedLine>
                Chưa có bản ghi chính thức để chọn làm căn cứ. Không dùng điều khoản nháp hoặc văn bản tự khai.
              </MutedLine>
            )}
          </fieldset>

          <Field id={`${uid}-reason`} label="Lý do" required>
            <TextArea
              id={`${uid}-reason`}
              value={reasoning}
              onChange={(v) => {
                w.onEdit();
                setReasoning(v);
              }}
              rows={3}
            />
          </Field>

          {!!view?.rows.length && (
            <Field id={`${uid}-sup`} label="Thay kết luận cũ (không bắt buộc)">
              <Select
                id={`${uid}-sup`}
                value={supersedes}
                onChange={(v) => {
                  w.onEdit();
                  setSupersedes(v);
                }}
                placeholder="Không thay kết luận nào"
                options={view.rows.map((r) => ({ value: r.id, label: `${r.resultLabel} · ${shortRef(r.id)}` }))}
              />
            </Field>
          )}

          {validation && <p role="alert" className="text-sm text-st-danger">{validation}</p>}

          <ActionButton
            onClick={() => void submit()}
            pending={w.pending}
            disabled={!candidates.length || w.mustReload}
            testId="contract-policy-submit"
          >
            Gửi đề xuất chính sách
          </ActionButton>

          <ErrorBox
            error={w.error}
            mustReload={w.mustReload}
            reloading={w.reloading}
            onReload={() => void w.reload()}
            onRetry={w.retry}
            pending={w.pending}
          />

          {w.result && !w.error && (
            <p role="status" className="text-sm text-adm-text">
              Đã lập đề xuất. Chưa thay đổi quyền phán quyết; cần người thứ hai duyệt.
            </p>
          )}
        </FormCard>
      )}
    </section>
  );
}

export function ContractPolicyLookup() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("contractPolicy") ?? "";
  const [input, setInput] = useState(selected);
  const [error, setError] = useState("");

  const onLookup = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(input.trim())) {
      setError("Nhập mã hợp đồng hợp lệ từ hồ sơ hợp đồng.");
      return;
    }
    setError("");
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set("contractPolicy", input.trim());
      return next;
    });
  };

  return (
    <details
      open={!!selected}
      className="space-y-3 rounded-xl border border-adm-border bg-adm-surface p-4"
      data-testid="contract-policy-lookup"
    >
      <summary className="min-h-11 cursor-pointer font-semibold text-adm-text">
        Rà soát chính sách theo hợp đồng
      </summary>
      <form onSubmit={onLookup} className="space-y-2">
        <label htmlFor="contract-policy-id" className="block text-sm text-adm-text">
          Mã hợp đồng cần rà soát
        </label>
        <input
          id="contract-policy-id"
          className="min-h-11 w-full rounded-md border border-adm-border bg-adm-surface p-2 text-sm text-adm-text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-invalid={!!error}
        />
        <button
          type="submit"
          className="min-h-11 rounded-md border border-adm-border px-3 text-sm text-adm-text"
        >
          Xem căn cứ hợp đồng
        </button>
        {error && (
          <p role="alert" className="text-sm text-st-danger">
            {error}
          </p>
        )}
      </form>
      {selected && <ContractPolicyPanel key={selected} contractId={selected} />}
    </details>
  );
}
