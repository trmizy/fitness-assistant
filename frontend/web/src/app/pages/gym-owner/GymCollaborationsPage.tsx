import { HandshakeIcon as Handshake } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { CollaborationPanel } from "../../components/gym/CollaborationPanel";
import { gymService } from "../../services/api";
import { ownerIntroCopy, ownerProposalOptions } from "../../utils/brandPartnership";

/**
 * The ONE place the owner manages PT partnerships. They are agreed with the BRAND (one PT + one brand =
 * one agreement, one set of terms for every open branch - decisions D5/D72): invite, negotiate, accept,
 * end with notice, and see the covered branches here. Branch pages no longer carry their own panel.
 */
export function GymCollaborationsPage() {
  // Same cache entry the panel reads: the intro says what is true for THIS owner (brand / brandless gyms / both).
  const { data: ownedGyms } = useQuery<any[]>({ queryKey: ["owned-gyms-for-collab"], queryFn: gymService.listOwnedGyms });
  const intro = ownerIntroCopy(ownerProposalOptions(ownedGyms));
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Handshake className="w-5 h-5 text-green-400" /> Quản lý cộng tác
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          {intro}
        </p>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5">
        <CollaborationPanel as="GYM" />
      </div>
    </div>
  );
}
