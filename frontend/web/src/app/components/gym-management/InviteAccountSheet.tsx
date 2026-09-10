import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "../ui/sheet";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { useIsMobile } from "../ui/use-mobile";
import { CircleNotchIcon } from "@phosphor-icons/react";

export interface InviteAccountSheetBranch {
  id: string;
  name: string;
}

export interface InviteAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: InviteAccountSheetBranch[];
  onInvite: (data: { email: string; scopedGymIds: string[] }) => void | Promise<void>;
}

/**
 * GYM_MANAGEMENT master spec §55/§61 — "Owner invites a MANAGER scoped to one branch."
 * Backed by `partnerService.inviteManager` (`POST /owner/partner-invitations`, role fixed to
 * MANAGER — see GYM_PARTNER_IDENTITY_MODEL.md, only an OWNER can reach this). Uses `Sheet`
 * (bottom on mobile, right-hand on desktop) per §48's "Invite manager" bottom-sheet example.
 */
export function InviteAccountSheet({ open, onOpenChange, branches, onInvite }: InviteAccountSheetProps) {
  const isMobile = useIsMobile();
  const [email, setEmail] = useState("");
  const [scoped, setScoped] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  function toggle(id: string) {
    setScoped((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleInvite() {
    setPending(true);
    try {
      await onInvite({ email: email.trim(), scopedGymIds: scoped });
      setEmail("");
      setScoped([]);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  const canSubmit = /\S+@\S+\.\S+/.test(email) && scoped.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={isMobile ? "max-h-[85vh] rounded-t-2xl" : ""}>
        <SheetHeader>
          <SheetTitle>Mời người quản lý</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-account-email">Email</Label>
            <Input id="invite-account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@vidu.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Phạm vi chi nhánh (chọn ít nhất một)</Label>
            <div className="space-y-1 rounded-lg border border-zinc-800 p-2 max-h-56 overflow-y-auto">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-800/60">
                  <Checkbox checked={scoped.includes(b.id)} onCheckedChange={() => toggle(b.id)} />
                  {b.name}
                </label>
              ))}
              {branches.length === 0 && <p className="text-xs text-zinc-500 px-2 py-1.5">Chưa có chi nhánh nào để gán.</p>}
            </div>
          </div>
        </div>
        <SheetFooter>
          <Button disabled={!canSubmit || pending} onClick={handleInvite}>
            {pending && <CircleNotchIcon className="size-4 animate-spin" />}
            Gửi lời mời
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
