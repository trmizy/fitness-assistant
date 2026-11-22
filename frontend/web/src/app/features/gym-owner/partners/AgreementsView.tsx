/**
 * OWNER screen of Đối tác PT: the PT agreements of the BRAND (`GET /owner/collaborations`, brand-wide, never filtered by branch).
 * Four segments (16 tabs-sliding, `?seg=`), one table (PT, status, the three stored rates, round, effect), a drawer per agreement
 * (`?agreement=<id>`, 07 panel-reveal) and a "Mời huấn luyện viên" drawer for a new proposal. Logic of turns, labels and copy lives in
 * `utils/brandPartnership.ts` (shared with the old panel); trainer names come from `profileService.getPTDetail` like the old panel
 * (cached per id, never an id on screen).
 * Only this component calls `/owner/collaborations`: the manager and the accountant screens never mount it.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CaretRightIcon, HandshakeIcon, PlusIcon } from "@phosphor-icons/react";
import { collaborationService, profileService } from "../../../services/api";
import { PT_NAME_FALLBACK, ownerIntroCopy, ownerProposalOptions, ptDisplayName } from "../../../utils/brandPartnership";
import { GoTabs } from "../../../components/layout/gym-owner/GoTabs";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope, useScopeChangeEffect } from "../scope/GymOwnerScopeProvider";
import { ALL_BRANCHES, classifyApiError, goKey } from "../scope/scopeModel";
import { isCurrentScopeData } from "../members/membersModel";
import { AgreementDrawer, type ProposeInit } from "./AgreementDrawer";
import { ProposeDrawer } from "./ProposeDrawer";
import {
  NO_BRAND_PROPOSAL_NOTE,
  PARTNERS_SUB,
  PARTNERS_TITLE,
  PT_INDEPENDENT_NOTE,
  SEGMENT_EMPTY,
  SEGMENT_IDS,
  SEGMENT_LABEL,
  buildPartnerRows,
  findPartnerRow,
  parseSegment,
  partnersSearch,
  segmentCounts,
  type PartnerRow,
  type SegmentId,
} from "./partnersModel";
import { SIGNED_CONTRACTS_NOTE } from "../../../utils/brandPartnership";

const COLS = "minmax(0, 1.8fr) minmax(0, 1.2fr) 84px 92px 92px 84px minmax(0, 1.3fr)";

export function AgreementsView() {
  const scope = useGymOwnerScope();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const agreementParam = params.get("agreement");
  const scopeKey = scope.scopeKey;
  const brandScope = { ...scope, gymId: ALL_BRANCHES };
  const listKey = goKey(brandScope, "pt-agreements");

  const [propose, setPropose] = useState<ProposeInit | "new" | null>(null);
  useScopeChangeEffect(() => setPropose(null));

  const query = useQuery<{ scopeKey: string; raw: unknown }>({
    queryKey: listKey,
    queryFn: async () => ({ scopeKey, raw: await collaborationService.listForOwner() }),
    enabled: scope.status === "ready" && scope.role === "OWNER",
  });
  const current = !!query.data && isCurrentScopeData(query.data.scopeKey, scopeKey);
  const rows = useMemo<PartnerRow[]>(() => (current ? buildPartnerRows(query.data?.raw) : []), [current, query.data]);
  const counts = useMemo(() => segmentCounts(rows), [rows]);

  // Trainer names: one cached lookup per id, the old panel's call. A failed lookup reads "Huấn luyện viên", never an id.
  const ptIds = useMemo(() => [...new Set(rows.map((r) => r.ptUserId).filter(Boolean))], [rows]);
  const nameQs = useQueries({
    queries: ptIds.map((id) => ({
      queryKey: goKey(brandScope, "pt-name", { id }),
      queryFn: async () => ptDisplayName(await profileService.getPTDetail(id)),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const names = new Map<string, string>(ptIds.map((id, i) => [id, nameQs[i]?.data ?? PT_NAME_FALLBACK]));
  const nameOf = (id: string) => names.get(id) ?? PT_NAME_FALLBACK;

  const options = useMemo(() => ownerProposalOptions(scope.gyms), [scope.gyms]);
  const openRow = findPartnerRow(rows, agreementParam);
  const seg: SegmentId = openRow ? openRow.segment : parseSegment(params.get("seg"));
  const shownRows = rows.filter((r) => r.segment === seg);

  const setSeg = (next: string) => navigate({ search: partnersSearch({ seg: next as SegmentId }) });
  const openAgreement = (r: PartnerRow) => navigate({ search: partnersSearch({ seg: r.segment, agreementId: r.key }) });
  const closeAgreement = () => navigate({ search: partnersSearch({ seg }) }, { replace: true });

  /** After any 2xx: the agreements list, the Today queue and the old panel's cache all refresh. */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "gym-owner" && q.queryKey[1] === scope.userId && (q.queryKey[5] === "collaborations" || q.queryKey[5] === "pt-agreements") });
    void queryClient.invalidateQueries({ queryKey: ["collab", scope.userId, "GYM"] });
  };

  if (query.isError && !query.data) {
    const kind = classifyApiError(query.error);
    if (kind === "forbidden") return <ScopeStateFrame kind="forbidden" />;
    return (
      <div className="go-state" role="alert" data-testid="go-pt-error">
        <h2>Không tải được thỏa thuận PT</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận bạn có hay không có thỏa thuận nào.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()}>Thử lại</button></div>
      </div>
    );
  }

  const loading = query.isLoading || scope.status !== "ready" || (!!query.data && !current);
  const canPropose = options.length > 0;
  const empty = SEGMENT_EMPTY[seg];

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-pt-page" data-view="agreements" data-seg={seg}>
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-pt-title">{PARTNERS_TITLE.agreements}</h1>
          <p className="go-page-sub">{PARTNERS_SUB.agreements}</p>
        </div>
        <button type="button" className="go-btn" data-variant="primary" onClick={() => setPropose("new")} disabled={!canPropose || loading} data-testid="go-pt-invite">
          <PlusIcon aria-hidden="true" width={16} height={16} /> Mời huấn luyện viên
        </button>
      </header>

      <div className="go-stack">
        <div className="go-note" role="note" data-testid="go-pt-intro">
          <HandshakeIcon aria-hidden="true" width={18} height={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <span>{ownerIntroCopy(options)}</span>
            <p>{PT_INDEPENDENT_NOTE}</p>
          </div>
        </div>
        {!canPropose && !loading && <div className="go-note" data-tone="warn" role="note" data-testid="go-pt-no-option">{NO_BRAND_PROPOSAL_NOTE}</div>}

        <GoTabs
          tabs={SEGMENT_IDS.map((id) => ({ id, label: SEGMENT_LABEL[id], count: loading ? undefined : counts[id], countLabel: "thỏa thuận" }))}
          value={seg}
          onChange={setSeg}
          idPrefix="go-pt"
          ariaLabel="Nhóm thỏa thuận PT"
        />

        <section className="go-panel" role="tabpanel" id={`go-pt-panel-${seg}`} aria-labelledby={`go-pt-tab-${seg}`} data-testid="go-pt-panel">
          <div className="go-panel-head">
            <h2>Thỏa thuận với PT</h2>
            <p>Áp dụng toàn thương hiệu. Một PT, một bộ tỷ lệ cho mọi chi nhánh.</p>
          </div>

          {loading && (
            <div className="go-task-skel" aria-hidden="true" data-testid="go-pt-skeleton">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "50%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
              ))}
            </div>
          )}

          {!loading && shownRows.length === 0 && (
            <div className="go-task-empty" data-testid="go-pt-empty">
              <strong>{rows.length === 0 ? "Chưa có thỏa thuận nào với PT" : empty.title}</strong>
              <span>{rows.length === 0 ? 'Chọn "Mời huấn luyện viên" để gửi đề xuất đầu tiên, hoặc chờ PT gửi đề xuất cho thương hiệu.' : empty.body}</span>
            </div>
          )}

          {!loading && shownRows.length > 0 && (
            <div role="table" className="go-dt" aria-label="Thỏa thuận PT" data-testid="go-pt-table" style={{ "--go-cols": COLS } as React.CSSProperties}>
              <div role="row" className="go-dt-row go-dt-head">
                <div role="columnheader">PT</div>
                <div role="columnheader">Trạng thái</div>
                <div role="columnheader" className="go-num">PT</div>
                <div role="columnheader" className="go-num">Phòng tập</div>
                <div role="columnheader" className="go-num">Nền tảng</div>
                <div role="columnheader">Vòng</div>
                <div role="columnheader">Hiệu lực</div>
              </div>
              {shownRows.map((r) => {
                const name = nameOf(r.ptUserId);
                const selected = openRow?.key === r.key;
                return (
                  <div key={r.key} role="row" className="go-dt-row" data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined} data-testid="go-pt-row" data-row-key={r.key} data-kind={r.kind}>
                    <div role="cell" className="go-dt-cell go-dt-first">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <button type="button" className="go-rowlink" onClick={() => openAgreement(r)} aria-label={`Mở thỏa thuận với ${name}`} data-testid="go-pt-open">{name}</button>
                        <span className="go-dt-sub">{r.scopeLine}</span>
                      </div>
                      <span className="go-dt-chev" aria-hidden="true"><CaretRightIcon /></span>
                    </div>
                    <div role="cell" className="go-dt-cell" data-label="Trạng thái"><GoTag tone={r.tag.tone} text={r.tag.text} /></div>
                    <div role="cell" className="go-dt-cell go-num go-rate-cell" data-label="Tỷ lệ PT" data-testid="go-pt-rate-pt">{r.rates ? r.rates.pt : "—"}</div>
                    <div role="cell" className="go-dt-cell go-num go-rate-cell" data-label="Tỷ lệ phòng tập">{r.rates ? r.rates.gym : "—"}</div>
                    <div role="cell" className="go-dt-cell go-num go-rate-cell" data-label="Tỷ lệ nền tảng">{r.rates ? r.rates.platform : "—"}</div>
                    <div role="cell" className="go-dt-cell" data-label="Vòng">{r.roundText}</div>
                    <div role="cell" className="go-dt-cell" data-label="Hiệu lực">{r.rates ? r.effectText : "Tỷ lệ khác nhau theo chi nhánh"}</div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && rows.length > 0 && (
            <p className="go-list-note" data-testid="go-pt-note">
              Tỷ lệ là phân số ghi trên thỏa thuận (0,55 là 55%), hiển thị nguyên giá trị. {SIGNED_CONTRACTS_NOTE}
            </p>
          )}
        </section>
      </div>

      <AgreementDrawer
        open={!!agreementParam}
        row={openRow}
        loaded={current}
        ptName={openRow ? nameOf(openRow.ptUserId) : PT_NAME_FALLBACK}
        onClose={closeAgreement}
        onChanged={refresh}
        onPropose={(init) => {
          closeAgreement();
          setPropose(init);
        }}
      />
      <ProposeDrawer
        open={propose !== null}
        init={propose === "new" ? null : propose}
        options={options}
        onClose={() => setPropose(null)}
        onSent={refresh}
      />
    </div>
  );
}
