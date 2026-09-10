import { HandshakeIcon as Handshake } from "@phosphor-icons/react";
import { CollaborationPanel } from "../../components/gym/CollaborationPanel";

/**
 * Every PT↔gym collaboration across ALL of the owner's branches, in one place — previously
 * only reachable by opening each gym's own management page one at a time to see if anything
 * was pending there. CollaborationPanel already aggregates across every branch when no gymId
 * is passed (GET /owner/collaborations has no gym filter); the only thing missing was a page
 * to mount that mode on. Proposing a NEW collaboration still happens from a specific branch's
 * own page (GymManagePage.tsx) — inviting a PT is inherently "at this location", not
 * brand-wide — so this view is read-and-respond only (accept / counter / reject / terminate).
 */
export function GymCollaborationsPage() {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Handshake className="w-5 h-5 text-green-400" /> Quản lý cộng tác
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Đề xuất hợp tác chia doanh thu với PT ở tất cả chi nhánh — muốn mời PT mới, vào trang quản
          lý của đúng chi nhánh đó.
        </p>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5">
        <CollaborationPanel as="GYM" />
      </div>
    </div>
  );
}
