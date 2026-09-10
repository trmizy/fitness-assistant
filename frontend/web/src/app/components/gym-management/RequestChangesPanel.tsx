import { useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";

export interface RequestChangesPanelProps {
  /** Read-only display of a standing request (owner's view, or admin reviewing history). */
  mode: "compose" | "view";
  nameNote?: string | null;
  addressNote?: string | null;
  onSubmit?: (notes: { nameNote?: string; addressNote?: string }) => void | Promise<void>;
  submitLabel?: string;
}

/**
 * GYM_MANAGEMENT master spec §55/§60/§62 — per-field "Request Changes", backed exactly by
 * `gymService.requestChanges` (Phase 1: `POST /admin/gyms/:id/request-changes` with
 * `{ nameNote?, addressNote? }`). "compose" is the admin's authoring view; "view" is what the
 * owner sees listing "exactly those N items" (§60's acceptance flow).
 */
export function RequestChangesPanel({ mode, nameNote, addressNote, onSubmit, submitLabel = "Gửi yêu cầu chỉnh sửa" }: RequestChangesPanelProps) {
  const [flagName, setFlagName] = useState(false);
  const [flagAddress, setFlagAddress] = useState(false);
  const [nameText, setNameText] = useState("");
  const [addressText, setAddressText] = useState("");

  if (mode === "view") {
    if (!nameNote && !addressNote) return null;
    return (
      <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <div className="flex items-center gap-1.5 text-amber-400 text-sm font-semibold">
          <WarningCircleIcon className="size-4" />
          Admin yêu cầu chỉnh sửa
        </div>
        {nameNote && (
          <div className="text-sm">
            <span className="font-medium text-zinc-300">Tên: </span>
            <span className="text-zinc-400">{nameNote}</span>
          </div>
        )}
        {addressNote && (
          <div className="text-sm">
            <span className="font-medium text-zinc-300">Địa chỉ: </span>
            <span className="text-zinc-400">{addressNote}</span>
          </div>
        )}
      </div>
    );
  }

  const canSubmit = (flagName && nameText.trim()) || (flagAddress && addressText.trim());

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={flagName} onCheckedChange={(v) => setFlagName(v === true)} />
          Yêu cầu chỉnh sửa Tên
        </label>
        {flagName && (
          <Textarea value={nameText} onChange={(e) => setNameText(e.target.value)} placeholder="Vì sao tên này cần sửa?" rows={2} />
        )}
      </div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={flagAddress} onCheckedChange={(v) => setFlagAddress(v === true)} />
          Yêu cầu chỉnh sửa Địa chỉ
        </label>
        {flagAddress && (
          <Textarea value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="Vì sao địa chỉ này cần sửa?" rows={2} />
        )}
      </div>
      <Button
        disabled={!canSubmit}
        onClick={() =>
          onSubmit?.({
            nameNote: flagName ? nameText.trim() : undefined,
            addressNote: flagAddress ? addressText.trim() : undefined,
          })
        }
      >
        {submitLabel}
      </Button>
    </div>
  );
}
