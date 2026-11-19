import type { GymAskedParty, PartyMoreInfo } from "../admin/complaints/gymCaseTypes";
import { askedPartiesText } from "../admin/complaints/gymCaseModel";
import { Notice } from "../disputes/PartyParts";

const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("vi-VN") : null);

/**
 * N15A-01: the admin's "yêu cầu bổ sung" shown to the party that was asked: what Gymini wrote, who was asked and by when.
 * Renders nothing once the party has answered (the server then sends `moreInfo: null`).
 */
export function MoreInfoNotice({ info, viewer }: { info: PartyMoreInfo | null | undefined; viewer: GymAskedParty }) {
  if (!info) return null;
  const who = askedPartiesText(info.askedParties, viewer);
  const due = when(info.dueAt);
  return (
    <Notice tone="warning" role="status" testId="gym-case-more-info">
      <p className="font-semibold">{viewer === "MEMBER" ? "Gymini cần bạn bổ sung thông tin" : "Gymini cần phòng gym của bạn giải trình hoặc bổ sung bằng chứng"}</p>
      {info.note ? <p className="mt-1 whitespace-pre-wrap break-words" data-testid="gym-case-more-info-note">{info.note}</p> : null}
      <p className="mt-1 text-xs">
        {who ? `Được hỏi: ${who}. ` : ""}
        {due ? `Hạn phản hồi: ${due}.` : "Bạn nên phản hồi sớm để hồ sơ được xử lý."}
      </p>
    </Notice>
  );
}
