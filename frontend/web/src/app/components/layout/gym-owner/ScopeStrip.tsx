/**
 * ScopeStrip - "which brand > which branch am I looking at" (06 section 3). Brand is fixed context; the branch is the variable.
 * Kind decides the control: brand-wide screens show static text, branch screens show BranchMenu.
 * Not wired to page data in G0: legacy pages keep their own selection until a later batch adopts the scope.
 */
import { branchCodes, roleLineParts } from "../../../features/gym-owner/scope/scopeModel";
import { useGymOwnerScope } from "../../../features/gym-owner/scope/GymOwnerScopeProvider";
import { BranchMenu } from "./BranchMenu";
import { TextSoft } from "./motion";

export function ScopeStrip() {
  const s = useGymOwnerScope();
  const parts = roleLineParts(s.role, s.gyms.length);
  const showBranchControl = (s.scopeKind === "branch" || s.scopeKind === "brand-or-branch") && s.gyms.length > 0;
  const codes = branchCodes(s.gyms);
  const single = s.gyms.length === 1 ? s.gyms[0] : null;

  let branchNode: React.ReactNode = null;
  if (s.status !== "ready") {
    branchNode = <span className="go-strip-static">Đang tải phạm vi...</span>;
  } else if (s.scopeKind === "brand") {
    branchNode = <span className="go-strip-static">Áp dụng toàn thương hiệu</span>;
  } else if (s.scopeKind === "none") {
    branchNode = null;
  } else if (s.gyms.length === 0) {
    branchNode = <span className="go-strip-static">Chưa có chi nhánh</span>;
  } else if (showBranchControl && !single) {
    branchNode = (
      <BranchMenu gyms={s.gyms} gymId={s.gymId} canOfferAll={s.canOfferAll} disabled={s.scopeChanging} onSelect={s.setGymId} />
    );
  } else if (single) {
    branchNode = (
      <span className="go-strip-static" style={{ display: "inline-flex", alignItems: "center", gap: "var(--go-s2)" }}>
        <span className="go-code-chip" aria-hidden="true" style={{ background: "rgb(255 255 255 / 0.16)", color: "var(--go-scope-ink)" }}>
          <TextSoft value={codes[single.id]} />
        </span>
        <TextSoft value={single.name} />
      </span>
    );
  }

  return (
    <section className="go-strip" aria-label="Phạm vi đang xem" data-testid="go-scope-strip" data-scope-key={s.scopeKey}>
      <div className="go-strip-left">
        <div className="go-strip-brand">
          <span className="go-strip-brand-label">Thương hiệu</span>
          <span className="go-strip-brand-name" data-testid="go-brand-name">{s.brandName ?? (s.status === "ready" ? "Phòng tập của bạn" : "...")}</span>
        </div>
        {branchNode && (
          <>
            <span className="go-strip-sep" aria-hidden="true">&rsaquo;</span>
            {branchNode}
          </>
        )}
      </div>
      <div className="go-strip-right" data-testid="go-role-line">
        {parts.map((p, i) => (
          <span key={p}>
            {i > 0 && <span aria-hidden="true" style={{ display: "inline-block", width: 1, height: 12, margin: "0 var(--go-s3)", background: "currentColor", opacity: 0.4, verticalAlign: "middle" }} />}
            {p}
          </span>
        ))}
      </div>
      <div className="go-strip-progress" data-active={s.scopeChanging ? "true" : "false"} role="progressbar" aria-hidden={!s.scopeChanging} aria-label="Đang chuyển phạm vi" />
    </section>
  );
}
