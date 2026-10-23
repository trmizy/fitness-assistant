import { useEffect, useState, type ReactNode } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  label: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  /** Returns a message when the text is not acceptable yet (the confirm button stays disabled and the message shows). */
  validate: (text: string) => string | null;
  /** Extra controls under the textarea (e.g. the "xóa hẳn tệp" checkbox). */
  children?: ReactNode;
  onConfirm: (text: string) => Promise<void> | void;
}

/**
 * One dialog for every "write a reason / note" step of the admin page: reject (note required), request changes
 * (note required), direct edit (reason ≥ 10 characters), retire a photo (reason ≥ 10), reject a proposal.
 * The text is cleared each time it opens; the confirm button is disabled while it is invalid or a request runs.
 */
export function ReasonDialog({ open, onOpenChange, title, description, label, placeholder, confirmLabel, danger, validate, children, onConfirm }: Props) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setText("");
      setTouched(false);
    }
  }, [open]);

  const error = validate(text);

  async function submit() {
    setTouched(true);
    if (error || pending) return;
    setPending(true);
    try {
      await onConfirm(text.trim());
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500" htmlFor="reason-dialog-text">
            {label}
          </label>
          <Textarea
            id="reason-dialog-text"
            value={text}
            rows={4}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && !!error}
          />
          {touched && error && <p className="text-xs text-red-400" role="alert">{error}</p>}
          {children}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Hủy
          </Button>
          <Button variant={danger ? "destructive" : "default"} onClick={submit} disabled={pending || !!error}>
            {pending && <CircleNotchIcon className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
