import { Text, View } from "react-native";
import { Check, Handshake, Repeat, Store, Trash2, TriangleAlert, X } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card } from "../../components/ui";
import {
  COVERAGE_COPY,
  LEGACY_OPEN_OFFER_NOTE,
  ratesLine,
  terminateBrandCopy,
  type BrandAgreementView,
  type LegacyGroupView,
  type LegacyRowView,
  type PartnershipCard,
  type PartnershipSections,
  type Viewer,
} from "./brandPartnership";

/**
 * The cards of the PT <-> Gym partnership list, shared by the PT screen and the gym-owner screen so the two
 * sides cannot describe the same agreement differently. All wording/mapping comes from brandPartnership.ts;
 * this file only draws it. testIDs / accessibility labels are stable on purpose (they are what the emulator
 * run drives).
 */

export type CounterTarget = { id: string; title: string; round: number; pt: string | null; gym: string | null; platform: string | null; branchOnly?: boolean };
export type TerminateTarget = { id: string; title: string; lines: string[] };
export type ProposeTarget = { brandId?: string; ptUserId?: string; doorBranchId?: string; repartner?: boolean };

export interface CardHandlers {
  busy: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCounter: (t: CounterTarget) => void;
  onTerminate: (t: TerminateTarget) => void;
  onPropose: (t: ProposeTarget) => void;
}

function Notice({ children, testID }: { children: string; testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-start gap-2 rounded-xl bg-panel px-3 py-2.5">
      <TriangleAlert size={14} color="#f59e0b" />
      <Text className="flex-1 font-body text-xs leading-4 text-foreground">{children}</Text>
    </View>
  );
}

function BrandCard({ c, viewer, nameOf, h }: { c: BrandAgreementView; viewer: Viewer; nameOf: (id: string) => string; h: CardHandlers }) {
  const title = viewer === "PT" ? c.brandName : nameOf(c.ptUserId);
  return (
    <View testID="collab-card-brand">
    <Card className="gap-3 p-4">
      <View className="gap-1.5">
        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>{title}</Text>
        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
          {viewer === "PT" ? "Thương hiệu" : `Thương hiệu ${c.brandName}`}
        </Text>
        <Badge tone={c.tone}>{c.label}</Badge>
      </View>

      <View className="gap-1 rounded-xl bg-panel px-3.5 py-2.5" testID="collab-rates">
        <Text className="font-body-semibold text-sm text-foreground">{ratesLine(c.rates)}</Text>
        <Text className="font-body text-[11px] text-muted-foreground">Tỷ lệ chung cho mọi chi nhánh của thương hiệu.</Text>
      </View>

      {c.branches.length > 0 ? (
        <View className="gap-1.5" testID="collab-covered-branches">
          <Text className="font-body text-[11px] leading-4 text-muted-foreground">
            Chi nhánh áp dụng ({c.branches.length}) — {COVERAGE_COPY}
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {c.branches.map((b) => (
              <View key={b.id} className="rounded-full border border-border px-2.5 py-1">
                <Text className="font-body text-[11px] text-foreground">
                  {b.name}
                  {b.closed ? " · tạm đóng" : ""}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {c.stage === "MY_TURN" || c.stage === "THEIR_TURN" ? (
        <Text className="font-body text-xs text-muted-foreground">
          Vòng {c.round}
          {c.expiresAt ? ` · hạn ${new Date(c.expiresAt).toLocaleDateString("vi-VN")}` : ""}
        </Text>
      ) : null}
      {c.noticeLine ? <Notice testID="collab-notice">{`Hiệu lực chấm dứt: ${c.effectiveDate}. ${c.noticeLine}`}</Notice> : null}
      {c.stage === "TERMINATED" && c.terminatedDate ? (
        <Text className="font-body text-xs text-muted-foreground">Chấm dứt ngày {c.terminatedDate}.</Text>
      ) : null}
      {c.note ? <Text className="font-body text-xs italic text-muted-foreground">“{c.note}”</Text> : null}

      {c.canRespond ? (
        <View className="flex-row gap-2">
          <Button className="flex-1" size="sm" icon={Check} disabled={h.busy} onPress={() => h.onAccept(c.id)}>
            Chấp nhận
          </Button>
          <Button
            className="flex-1"
            size="sm"
            variant="secondary"
            icon={Repeat}
            onPress={() => h.onCounter({ id: c.id, title, round: c.round, pt: c.raw.pt, gym: c.raw.gym, platform: c.raw.platform })}
          >
            Đề xuất lại
          </Button>
          <Button className="flex-1" size="sm" variant="ghost" icon={X} disabled={h.busy} onPress={() => h.onReject(c.id)}>
            Từ chối
          </Button>
        </View>
      ) : null}

      {c.canTerminate ? (
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          disabled={h.busy}
          onPress={() => {
            const copy = terminateBrandCopy(viewer, title);
            h.onTerminate({ id: c.id, title: copy.title, lines: copy.lines });
          }}
        >
          Chấm dứt hợp tác
        </Button>
      ) : null}

      {c.canRepartner ? (
        <Button
          size="sm"
          icon={Handshake}
          onPress={() => h.onPropose({ brandId: c.brandId, ptUserId: c.ptUserId, doorBranchId: c.proposeBranchId ?? undefined, repartner: true })}
        >
          Hợp tác lại
        </Button>
      ) : null}
    </Card>
    </View>
  );
}

function LegacyRow({ r, h, branchOnly }: { r: LegacyRowView; h: CardHandlers; branchOnly: boolean }) {
  return (
    <View className="gap-2 rounded-xl border border-border p-3" testID="collab-legacy-row">
      <Text className="font-body-semibold text-xs text-foreground" numberOfLines={2}>{r.branchName}</Text>
      <Badge tone={r.tone}>{r.label}</Badge>
      <Text className="font-body text-[11px] leading-4 text-muted-foreground">
        {r.ratesCaption}: {ratesLine(r.rates)}
      </Text>
      {r.stage === "TERMINATING" && r.effectiveDate ? (
        <Text className="font-body text-[11px] text-warning">Chấm dứt ngày {r.effectiveDate}.</Text>
      ) : null}
      {r.stage === "MY_TURN" && !r.canAcceptOrCounter ? (
        <Text className="font-body text-[11px] leading-4 text-muted-foreground">{LEGACY_OPEN_OFFER_NOTE}</Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {r.canAcceptOrCounter ? (
          <>
            <Button size="sm" icon={Check} disabled={h.busy} onPress={() => h.onAccept(r.id)}>Chấp nhận</Button>
            <Button
              size="sm"
              variant="secondary"
              icon={Repeat}
              onPress={() => h.onCounter({ id: r.id, title: r.branchName, round: r.round, pt: r.raw.pt, gym: r.raw.gym, platform: r.raw.platform, branchOnly })}
            >
              Đề xuất lại
            </Button>
          </>
        ) : null}
        {r.canReject ? (
          <Button size="sm" variant="ghost" icon={X} disabled={h.busy} onPress={() => h.onReject(r.id)}>Từ chối</Button>
        ) : null}
        {r.canTerminate ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            disabled={h.busy}
            onPress={() => {
              h.onTerminate({ id: r.id, title: r.terminateCopy.title, lines: r.terminateCopy.lines });
            }}
          >
            {r.terminateLabel}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function LegacyGroup({ g, viewer, nameOf, h }: { g: LegacyGroupView; viewer: Viewer; nameOf: (id: string) => string; h: CardHandlers }) {
  const title = viewer === "PT" ? g.brandName : nameOf(g.ptUserId);
  return (
    <View testID="collab-card-legacy">
    <Card className="gap-3 p-4">
      <View className="gap-1">
        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>{title}</Text>
        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
          {g.branded ? `Thương hiệu ${g.brandName}` : "Chi nhánh chưa có thương hiệu"}
        </Text>
      </View>
      <View testID="collab-legacy-headline" className="gap-1.5 rounded-xl bg-panel px-3 py-2.5">
        <Text className="font-body-semibold text-xs leading-4 text-foreground">{g.headline}</Text>
        {g.detail ? <Text className="font-body text-xs leading-4 text-muted-foreground">{g.detail}</Text> : null}
      </View>
      <View className="gap-2">
        {g.rows.map((r) => (
          <LegacyRow key={r.id} r={r} h={h} branchOnly={!g.branded} />
        ))}
      </View>
      {g.canProposeJoint ? (
        <Button
          size="sm"
          icon={Store}
          onPress={() => h.onPropose({ brandId: g.brandId ?? undefined, ptUserId: g.ptUserId, doorBranchId: g.proposeBranchId ?? undefined })}
        >
          Đề xuất thỏa thuận chung cho thương hiệu
        </Button>
      ) : null}
    </Card>
    </View>
  );
}

function Section({ id, title, cards, viewer, nameOf, h }: { id: string; title: string; cards: PartnershipCard[]; viewer: Viewer; nameOf: (id: string) => string; h: CardHandlers }) {
  if (cards.length === 0) return null;
  return (
    <View testID={`collab-section-${id}`} className="gap-2">
      <Text className="font-body-semibold text-xs uppercase text-muted-foreground">{title}</Text>
      {cards.map((c) =>
        c.kind === "BRAND" ? (
          <BrandCard key={c.id} c={c} viewer={viewer} nameOf={nameOf} h={h} />
        ) : (
          <LegacyGroup key={c.key} g={c} viewer={viewer} nameOf={nameOf} h={h} />
        ),
      )}
    </View>
  );
}

export function PartnershipList({ sections, viewer, nameOf, handlers }: { sections: PartnershipSections; viewer: Viewer; nameOf: (id: string) => string; handlers: CardHandlers }) {
  return (
    <View className="gap-4">
      <Section id="needs-reply" title="Cần bạn trả lời" cards={sections.needsReply} viewer={viewer} nameOf={nameOf} h={handlers} />
      <Section id="current" title="Đang hiệu lực / đang chờ" cards={sections.current} viewer={viewer} nameOf={nameOf} h={handlers} />
      <Section id="ended" title="Đã kết thúc" cards={sections.ended} viewer={viewer} nameOf={nameOf} h={handlers} />
    </View>
  );
}

/** Confirmation shown BEFORE ending an agreement: says exactly what the server will do. */
export function TerminateSheet({ target, pending, onClose, onConfirm }: { target: TerminateTarget | null; pending: boolean; onClose: () => void; onConfirm: (id: string) => void }) {
  return (
    <BottomSheet open={!!target} onClose={onClose} title={target?.title ?? ""}>
      <View className="gap-3 pb-2" testID="collab-terminate-sheet">
        {(target?.lines ?? []).map((l) => (
          <Text key={l} className="font-body text-sm leading-5 text-muted-foreground">
            {"• "}
            {l}
          </Text>
        ))}
        <View className="flex-row gap-2">
          <Button className="flex-1" variant="secondary" onPress={onClose}>
            Không
          </Button>
          <Button className="flex-1" variant="destructive" disabled={pending} onPress={() => target && onConfirm(target.id)}>
            {pending ? "Đang xử lý…" : "Chấm dứt"}
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}
