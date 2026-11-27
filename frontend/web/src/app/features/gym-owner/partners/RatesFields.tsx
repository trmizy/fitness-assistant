/**
 * The two editable rates of a PT agreement (PT %, phòng tập %) with the platform share fixed at 10%, exactly the old
 * CollaborationPanel form: the three must add up to 100, said before the request. The server stays the authority for the exact sum,
 * the platform floor and the turn (RATES_MUST_SUM_TO_ONE, PLATFORM_RATE_TOO_LOW ...) and its sentence is shown when it refuses.
 */
import { PLATFORM_PCT, RATES_SERVER_NOTE, type RatesState } from "./partnersModel";

export function RatesFields({
  pt,
  gym,
  onPt,
  onGym,
  state,
  scopeNote,
  idPrefix,
}: {
  pt: string;
  gym: string;
  onPt: (v: string) => void;
  onGym: (v: string) => void;
  state: RatesState;
  /** "Bộ tỷ lệ này áp dụng cho mọi chi nhánh của thương hiệu." or the single-branch sentence. */
  scopeNote: string;
  idPrefix: string;
}) {
  const sumText = Number.isFinite(state.sum) ? `${String(state.sum).replace(".", ",")}%` : "chưa đủ số";
  return (
    <div className="go-form-box" data-testid="go-rates-fields">
      <div className="go-grid-2">
        <label className="go-field" htmlFor={`${idPrefix}-pt`}>
          <span className="go-label">PT (%)</span>
          <input id={`${idPrefix}-pt`} className="go-input" type="number" inputMode="decimal" step="any" min={0} value={pt} onChange={(e) => onPt(e.target.value)} aria-label="Tỷ lệ của PT, phần trăm" data-testid="go-rate-pt" />
        </label>
        <label className="go-field" htmlFor={`${idPrefix}-gym`}>
          <span className="go-label">Phòng tập (%)</span>
          <input id={`${idPrefix}-gym`} className="go-input" type="number" inputMode="decimal" step="any" min={0} value={gym} onChange={(e) => onGym(e.target.value)} aria-label="Tỷ lệ của phòng tập, phần trăm" data-testid="go-rate-gym" />
        </label>
      </div>
      <p className="go-hint-text" data-testid="go-rate-sum" aria-live="polite">
        Nền tảng giữ cố định {PLATFORM_PCT}%. Tổng hiện tại:{" "}
        <strong style={{ color: state.ok ? "var(--go-ok)" : "var(--go-risk)" }}>{sumText}</strong>. {scopeNote}
      </p>
      {!state.ok && (
        <p className="go-field-error" role="alert" data-testid="go-rate-sum-error">
          Tổng ba tỷ lệ phải bằng đúng 100%. Máy chủ sẽ từ chối nếu lệch, kể cả lệch rất nhỏ.
        </p>
      )}
      <p className="go-hint-text">{RATES_SERVER_NOTE}</p>
    </div>
  );
}
