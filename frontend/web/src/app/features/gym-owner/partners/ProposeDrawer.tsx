/**
 * "Mời huấn luyện viên" drawer: a NEW proposal from the owner (same call as the old panel: `collaborationService.proposeAsGym(doorBranchId,
 * { ptRate, gymRate, platformRate, ptUserId })`). The agreement is made with the BRAND, one set of terms for every open branch; a brandless
 * gym keeps the single-branch agreement of old and says so. Also serves "Hợp tác lại" and "Đề xuất thỏa thuận chung" (pre-filled PT).
 * Closing with anything typed asks first. 10 success-check only after a 2xx, a refusal shows the server's sentence (12 shake).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { collaborationService, profileService } from "../../../services/api";
import { optionLabel, optionNote, proposeCopy, ptDisplayName, type BrandOption } from "../../../utils/brandPartnership";
import { GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { goKey, ALL_BRANCHES } from "../scope/scopeModel";
import { RatesFields } from "./RatesFields";
import { collabErrorMessage, ratesState } from "./partnersModel";
import type { ProposeInit } from "./AgreementDrawer";

type Phase = "idle" | "sending" | "done";
const DEFAULT_PT = "55";
const DEFAULT_GYM = "35";

export function ProposeDrawer({
  open,
  init,
  options,
  onClose,
  onSent,
}: {
  open: boolean;
  init: ProposeInit | null;
  options: BrandOption[];
  onClose: () => void;
  onSent: () => void;
}) {
  const scope = useGymOwnerScope();
  const [optionId, setOptionId] = useState("");
  const [ptSearch, setPtSearch] = useState("");
  const [ptId, setPtId] = useState("");
  const [ptPct, setPtPct] = useState(DEFAULT_PT);
  const [gymPct, setGymPct] = useState(DEFAULT_GYM);
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState("");
  const [askDiscard, setAskDiscard] = useState(false);
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const preset = !!init?.ptUserId;

  // A fresh form every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setOptionId(init?.brandId ?? "");
    setPtSearch(init?.ptName ?? "");
    setPtId(init?.ptUserId ?? "");
    setPtPct(DEFAULT_PT);
    setGymPct(DEFAULT_GYM);
    setPhase("idle");
    setRefusal("");
    setAskDiscard(false);
  }, [open, init]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const selected = options.find((o) => o.brandId === (optionId || options[0]?.brandId)) ?? null;
  const doorBranchId = init?.doorBranchId ?? selected?.proposeBranchId ?? "";
  const q = ptSearch.trim();
  const hits = useQuery<{ userId: string; name: string }[]>({
    queryKey: goKey({ ...scope, gymId: ALL_BRANCHES }, "pt-search", { q }),
    queryFn: async () => {
      const res = await profileService.listPTs({ q, limit: 8 });
      const list = Array.isArray(res?.pts) ? res.pts : Array.isArray(res) ? res : [];
      return list.map((p: any) => ({ userId: String(p?.userId ?? p?.id ?? ""), name: ptDisplayName(p) })).filter((p: { userId: string }) => p.userId);
    },
    enabled: open && !preset && q.length >= 2 && !ptId,
    staleTime: 60_000,
  });

  const send = useMutation({
    mutationFn: (v: { doorBranchId: string; ptUserId: string; body: { ptRate: string; gymRate: string; platformRate: string } }) =>
      collaborationService.proposeAsGym(v.doorBranchId, { ...v.body, ptUserId: v.ptUserId }),
  });

  const rates = ratesState(ptPct, gymPct);
  const canSubmit = !!doorBranchId && !!ptId && rates.ok && phase === "idle";
  const dirty = phase !== "done" && ((!preset && (ptSearch.trim() !== "" || ptId !== "")) || ptPct !== DEFAULT_PT || gymPct !== DEFAULT_GYM);
  const requestClose = () => {
    if (phase === "sending") return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };

  const submit = async () => {
    if (!canSubmit || !rates.body) return;
    setRefusal("");
    setPhase("sending");
    try {
      await send.mutateAsync({ doorBranchId, ptUserId: ptId, body: rates.body });
      setPhase("done"); // 2xx only
      toast.success("Đã gửi đề xuất hợp tác");
      onSent();
      timer.current = setTimeout(onClose, 900);
    } catch (err) {
      setPhase("idle");
      setRefusal(collabErrorMessage(err));
      shake.shake();
    }
  };

  const brandless = selected?.scope === "BRANCH";
  const title = proposeCopy("GYM", !!init?.repartner).title;
  const label = phase === "sending" ? "Đang gửi" : phase === "done" ? "Đã gửi" : "Gửi đề xuất";

  return (
    <>
      <GoDrawer
        open={open}
        onClose={requestClose}
        busy={phase === "sending"}
        closeOnBackdrop={false}
        initialFocusRef={searchRef}
        title={title}
        description="Gửi đề xuất chia doanh thu cho một huấn luyện viên. Thỏa thuận ký với cả thương hiệu."
        testId="go-propose-drawer"
        meta={<span className="go-muted">{brandless ? "Chỉ áp dụng riêng cho chi nhánh này" : "Áp dụng toàn thương hiệu"}</span>}
        footer={
          <div className="go-drawer-foot-row">
            <button type="button" className="go-btn" onClick={requestClose} disabled={phase === "sending"}>Huỷ</button>
            <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={!canSubmit} data-testid="go-propose-send">
              <SuccessCheck show={phase === "done"} />
              <TextStates value={label} />
            </button>
          </div>
        }
      >
        <div ref={shake.ref} className="go-form-box" data-testid="go-propose-form">
          {refusal && <p className="go-result" data-tone="risk" role="alert" data-testid="go-propose-refusal">{refusal}</p>}

          {options.length > 1 && (
            <label className="go-field">
              <span className="go-label">Hợp tác cho</span>
              <select className="go-select" aria-label="Hợp tác cho" value={selected?.brandId ?? ""} disabled={!!init?.repartner || !!init?.brandId} onChange={(e) => setOptionId(e.target.value)} data-testid="go-propose-option">
                {options.map((o) => <option key={o.brandId} value={o.brandId}>{optionLabel(o)}</option>)}
              </select>
            </label>
          )}
          {selected && (
            <p className="go-hint-text" data-testid="go-propose-note">
              {selected.scope === "BRAND" ? <>Thương hiệu <strong>{selected.brandName}</strong>. </> : <><strong>{selected.brandName}</strong>. </>}
              {optionNote(selected)}
            </p>
          )}

          <div className="go-field">
            <label className="go-label" htmlFor="go-propose-pt">Huấn luyện viên</label>
            <input
              id="go-propose-pt"
              ref={searchRef}
              className="go-input"
              value={ptSearch}
              disabled={preset}
              onChange={(e) => { setPtSearch(e.target.value); setPtId(""); }}
              placeholder="Gõ tên huấn luyện viên để tìm"
              autoComplete="off"
              data-testid="go-propose-search"
            />
            {ptId ? (
              <p className="go-hint-text" data-testid="go-propose-picked" style={{ color: "var(--go-ok)" }}>Đã chọn: {ptSearch}</p>
            ) : q.length >= 2 ? (
              <ul className="go-pick-list" data-testid="go-propose-hits">
                {hits.isFetching && <li className="go-muted">Đang tìm…</li>}
                {!hits.isFetching && hits.isError && <li className="go-field-error">Không tìm được lúc này. Thử lại.</li>}
                {!hits.isFetching && !hits.isError && (hits.data ?? []).length === 0 && <li className="go-muted">Không tìm thấy huấn luyện viên.</li>}
                {(hits.data ?? []).map((p) => (
                  <li key={p.userId}>
                    <button type="button" className="go-pick" onClick={() => { setPtId(p.userId); setPtSearch(p.name); }} data-testid="go-propose-hit">{p.name}</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <RatesFields pt={ptPct} gym={gymPct} onPt={setPtPct} onGym={setGymPct} state={rates} idPrefix="go-propose" scopeNote={brandless ? "Tỷ lệ này chỉ áp dụng riêng cho chi nhánh này." : "Bộ tỷ lệ này áp dụng cho mọi chi nhánh của thương hiệu."} />
        </div>
      </GoDrawer>

      <GoModal
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title="Bỏ đề xuất đang soạn?"
        description="Những gì bạn đã nhập chưa được gửi và sẽ mất."
        testId="go-propose-discard"
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => setAskDiscard(false)}>Tiếp tục soạn</button>
            <button type="button" className="go-btn" data-variant="danger" onClick={() => { setAskDiscard(false); onClose(); }}>Bỏ và đóng</button>
          </>
        }
      />
    </>
  );
}
