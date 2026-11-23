/**
 * Quầy lễ tân (batch G3), `/gym-owner/front-desk`, behind VITE_GYM_OWNER_V2. A BRANCH screen (`?gymId=` from the scope strip) for
 * owner, manager and receptionist. Tabs (16, URL `?tab=checkin|exceptions|pt&exception=<id>`):
 *  - Tìm & check-in: left the legacy `AssistedCheckinPanel` (search by code / name + last 4, verification, OTP, confirm; handlers
 *    untouched), right "Hôm nay tại quầy" (the legacy `frontDeskToday` data, refetched every 15 s) and the legacy `GymCheckinPanel` (QR).
 *  - Ngoại lệ (count of waiting requests, 36): list + drawer with the investigation and the decision (owner / manager).
 *  - PT hôm nay: `GET .../pt-checkins/today`.
 * The check-in tab stays mounted while another tab is shown, so a half-done check-in is not lost. Leaving the branch with something
 * typed asks first (useBlocker); a scope change closes the drawer and drops the row.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../../context/AppContext";
import { gymService } from "../../../services/api";
import { GymCheckinPanel } from "../../../components/gym/GymCheckinPanel";
import { AssistedCheckinPanel } from "../../../components/gym/AssistedCheckinPanel";
import { normalizeExceptions } from "../../../utils/assistedCheckin";
import { clockLabel, filterByName, normalizeFrontDeskToday, normalizeTodayPts, presenceOf, type FrontDeskToday, type TodayPt } from "../../../utils/frontDeskToday";
import { GoTabs } from "../../../components/layout/gym-owner/GoTabs";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { GoSearch } from "../../../components/layout/gym-owner/GoSearch";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope, useScopeChangeEffect } from "../scope/GymOwnerScopeProvider";
import { ExceptionsTab } from "./ExceptionsTab";
import { ExceptionDrawer } from "./ExceptionDrawer";
import { FD_TAB_IDS, FD_TAB_LABEL, canUseDesk, fdSearch, findException, parseFdTab, pendingCount, shouldAskBeforeLeaving, type FdTabId } from "./frontDeskModel";

export function FrontDeskPage() {
  const scope = useGymOwnerScope();
  const { user } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The same keys as the legacy panels, so a check-in or an exception request made in a panel refreshes this page too.
  const uid = user?.id ?? "guest";
  const gymId = scope.gymId;
  const gym = scope.gyms.find((g) => g.id === gymId);
  const exceptionParam = params.get("exception");
  const tab = parseFdTab(params.get("tab"), exceptionParam);
  const prefillCode = params.get("code") ?? undefined;
  const ready = scope.status === "ready" && gymId !== "ALL";

  const [assistedDirty, setAssistedDirty] = useState(false);
  const [decisionDirty, setDecisionDirty] = useState(false);
  const dirty = assistedDirty || decisionDirty;

  const exceptionsQ = useQuery({
    queryKey: ["frontdesk-exceptions", uid, gymId],
    queryFn: async () => normalizeExceptions(await gymService.listCheckinExceptions(gymId)),
    enabled: ready,
    refetchInterval: 8000,
  });
  const todayQ = useQuery<FrontDeskToday>({
    queryKey: ["frontdesk-today", uid, gymId],
    queryFn: async () => normalizeFrontDeskToday(await gymService.getFrontDeskToday(gymId)),
    enabled: ready,
    refetchInterval: 15000,
  });
  const ptQ = useQuery<TodayPt[]>({
    queryKey: ["gym-pt-checkins-today", uid, gymId],
    queryFn: async () => normalizeTodayPts(await gymService.listPtCheckinsToday(gymId)),
    enabled: ready && tab === "pt",
    refetchInterval: 15000,
  });

  const [guestQ, setGuestQ] = useState("");
  const guests = useMemo(() => filterByName(todayQ.data?.clients ?? [], guestQ), [todayQ.data, guestQ]);

  // Scope change: drawer closed (the `exception` param belongs to the old branch), search boxes cleared, flags reset by the unmounts.
  useScopeChangeEffect(() => {
    setGuestQ("");
    setAssistedDirty(false);
    setDecisionDirty(false);
    if (new URLSearchParams(window.location.search).has("exception")) {
      const next = new URLSearchParams(window.location.search);
      next.delete("exception");
      setParams(next, { replace: true });
    }
  });

  // Leaving the branch (or the page) with typed, unsent input asks first. Same-branch tab / drawer moves never ask.
  // The drawer asks by itself on its own close / Esc, then closes with force: that single move must not be asked about again.
  const bypass = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !bypass.current && shouldAskBeforeLeaving({ dirty, decisionDirty, from: { pathname: currentLocation.pathname, search: currentLocation.search }, to: { pathname: nextLocation.pathname, search: nextLocation.search } }),
  );
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (!canUseDesk(scope.can)) return <ScopeStateFrame kind="forbidden" />;

  const exData = exceptionsQ.data;
  const rows = exData?.exceptions ?? [];
  const canApprove = exData?.canApprove ?? false;
  const nowMs = Date.now();
  const pend = pendingCount(rows, nowMs);
  const open = findException(rows, exceptionParam);

  const setTab = (next: string) => navigate({ search: fdSearch({ gymId, tab: next as FdTabId }) });
  const openException = (id: string) => navigate({ search: fdSearch({ gymId, tab: "exceptions", exceptionId: id }) });
  const closeException = (force?: boolean) => {
    if (force) {
      bypass.current = true;
      window.setTimeout(() => { bypass.current = false; }, 0);
    }
    void navigate({ search: fdSearch({ gymId, tab: "exceptions" }) }, { replace: true });
  };

  const sub =
    !scope.can("checkin.exception.approve")
      ? "Tìm hội viên, check-in hộ khi họ không quét được mã QR, xin ngoại lệ."
      : "Tìm hội viên, check-in hộ, duyệt ngoại lệ và xem ai đang ở quầy.";

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-front-desk" data-tab={tab}>
      <header className="go-page-head">
        <div className="go-fd-head">
          <h1 data-testid="go-front-desk-title">Quầy lễ tân</h1>
          <p className="go-page-sub">{sub}</p>
        </div>
      </header>

      <GoTabs
        tabs={FD_TAB_IDS.map((id) => ({ id, label: FD_TAB_LABEL[id], count: id === "exceptions" ? pend : undefined, countLabel: "chờ duyệt" }))}
        value={tab}
        onChange={setTab}
        idPrefix="go-fd"
        ariaLabel="Mục của Quầy lễ tân"
      />

      {/* Tìm & check-in: always mounted so typed input survives a look at another tab. */}
      <div role="tabpanel" id="go-fd-panel-checkin" aria-labelledby="go-fd-tab-checkin" tabIndex={-1} hidden={tab !== "checkin"} className="go-tabpanel" data-tab="checkin">
        {ready && (
          <div className="go-fd-grid">
            <div className="go-fd-left">
              <section className="go-panel" aria-labelledby="go-h-find">
                <div className="go-panel-head"><h2 id="go-h-find">Tìm hội viên và check-in hộ</h2><p>Mã hội viên, hoặc tên kèm 4 ký tự cuối của mã. Mọi bước đều được ghi lại.</p></div>
                <div className="go-fd-embed" data-testid="go-fd-assisted">
                  {/* The legacy panel, unchanged: lookup, verification (photo / OTP / exception), idempotent confirm. */}
                  <AssistedCheckinPanel gymId={gymId} onDirtyChange={setAssistedDirty} prefillCode={prefillCode} />
                </div>
              </section>
            </div>
            <div className="go-fd-right">
              <section className="go-panel" aria-labelledby="go-h-today" data-testid="go-fd-today">
                <div className="go-panel-head">
                  <h2 id="go-h-today">Hôm nay tại quầy</h2>
                  <p>{todayQ.data ? `${todayQ.data.clients.length} người đã vào hoặc có lịch tập` : "Đang tải"}</p>
                </div>
                <div className="go-guest-search"><GoSearch value={guestQ} onChange={setGuestQ} placeholder="Tìm khách hôm nay theo tên" ariaLabel="Tìm khách hôm nay theo tên" testId="go-fd-guest-search" /></div>
                {todayQ.isLoading && <div className="go-task-skel" aria-hidden="true"><div className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "60%" }} /></div></div>}
                {todayQ.isError && (
                  <div className="go-notice" data-tone="risk" role="alert"><span>Không tải được danh sách khách hôm nay.</span><button type="button" className="go-btn go-btn-sm" onClick={() => void todayQ.refetch()}>Thử lại</button></div>
                )}
                {todayQ.data && guests.length === 0 && (
                  <div className="go-task-empty" data-testid="go-fd-today-empty">
                    <strong>{guestQ.trim() ? "Không có khách phù hợp" : "Hôm nay chưa có khách"}</strong>
                    <span>{guestQ.trim() ? "Thử bỏ bớt từ khoá tìm kiếm." : "Khách sẽ hiện ở đây khi họ check-in hoặc có lịch tập tại chi nhánh."}</span>
                  </div>
                )}
                {guests.length > 0 && (
                  <ul className="go-guest-list" data-testid="go-fd-guests">
                    {guests.map((c, i) => {
                      const p = presenceOf(c);
                      return (
                        <li key={`${i}-${c.displayName}`} className="go-guest" style={{ "--i": Math.min(i, 5) } as React.CSSProperties}>
                          <span className="go-guest-name">{c.displayName}</span>
                          <GoTag tone={p.kind === "CHECKED_IN" ? "ok" : "info"} text={p.label} />
                        </li>
                      );
                    })}
                  </ul>
                )}
                {todayQ.data && !todayQ.data.bookingsAvailable && <p className="go-list-note" data-testid="go-fd-bookings-unavailable">Chưa tải được lịch tập hôm nay, danh sách chỉ gồm người đã check-in.</p>}
              </section>
              <section className="go-panel" aria-label="Mã QR check-in">
                <div className="go-fd-embed" style={{ paddingTop: "var(--go-s4)" }} data-testid="go-fd-qr">
                  {/* The legacy QR panel, unchanged (QR, regenerate, enlarge, recent check-ins). PT today has its own tab. */}
                  <GymCheckinPanel gymId={gymId} ptCheckinsMode="none" branch={gym as never} />
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      <div role="tabpanel" id="go-fd-panel-exceptions" aria-labelledby="go-fd-tab-exceptions" tabIndex={-1} hidden={tab !== "exceptions"} className="go-tabpanel" data-tab="exceptions">
        {tab === "exceptions" && ready && (
          <>
            <ExceptionsTab
              gymId={gymId}
              canApprove={canApprove}
              rows={rows}
              loading={exceptionsQ.isLoading}
              failed={exceptionsQ.isError && !exData}
              onRetry={() => void exceptionsQ.refetch()}
              openId={open ? open.id : exceptionParam}
              onOpen={openException}
            />
            <ExceptionDrawer
              open={!!exceptionParam}
              row={open}
              loaded={!!exData}
              canApprove={canApprove}
              gymId={gymId}
              gymName={gym?.name ?? "chi nhánh"}
              uid={uid}
              onClose={(force) => closeException(force)}
              onDirtyChange={setDecisionDirty}
            />
          </>
        )}
      </div>

      <div role="tabpanel" id="go-fd-panel-pt" aria-labelledby="go-fd-tab-pt" tabIndex={-1} hidden={tab !== "pt"} className="go-tabpanel" data-tab="pt">
        {tab === "pt" && ready && (
          <section className="go-panel" aria-labelledby="go-h-pt" data-testid="go-fd-pt">
            <div className="go-panel-head"><h2 id="go-h-pt">PT hôm nay</h2><p>PT đã check-in tại {gym?.name ?? "chi nhánh"} hôm nay (quét mã QR ở quầy).</p></div>
            {ptQ.isLoading && <div className="go-task-skel" aria-hidden="true"><div className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "40%" }} /></div></div>}
            {ptQ.isError && (
              <div className="go-notice" data-tone="risk" role="alert"><span>Không tải được danh sách PT hôm nay.</span><button type="button" className="go-btn go-btn-sm" onClick={() => void ptQ.refetch()}>Thử lại</button></div>
            )}
            {ptQ.data && ptQ.data.length === 0 && (
              <div className="go-task-empty" data-testid="go-fd-pt-empty"><strong>Chưa có PT nào check-in hôm nay</strong><span>PT quét mã QR tại quầy sẽ hiện ở đây.</span></div>
            )}
            {ptQ.data && ptQ.data.length > 0 && (
              <ul className="go-guest-list" data-testid="go-fd-pt-list">
                {ptQ.data.map((p) => (
                  <li key={p.id} className="go-guest"><span className="go-guest-name">{p.ptName}</span><span className="go-muted">Vào lúc {clockLabel(p.firstScanAt)}</span></li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <GoModal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        closeOnBackdrop={false}
        testId="go-fd-leave"
        title="Rời đi khi chưa xong?"
        description="Bạn đang làm dở một check-in hộ hoặc đã gõ lý do chưa gửi. Quay lại, đổi chi nhánh hay sang trang khác sẽ làm mất những gì đã nhập."
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => blocker.reset?.()}>Ở lại</button>
            <button type="button" className="go-btn" data-variant="danger" onClick={() => { setAssistedDirty(false); setDecisionDirty(false); blocker.proceed?.(); }} data-testid="go-fd-leave-go">Rời đi</button>
          </>
        }
      />
    </div>
  );
}
