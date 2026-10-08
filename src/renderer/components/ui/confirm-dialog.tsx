import * as React from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { cn } from "@renderer/lib/cn";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the action will do, spelled out — including what it will not touch. */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ends a process or deletes a row: red button, `alertdialog` semantics. */
  destructive?: boolean;
  /** The action is in flight; both buttons are held. */
  pending?: boolean;
  onConfirm: () => void;
}

/**
 * ConfirmDialog — one blocking "are you sure" for the whole app.
 *
 * Killing a detected dev server used to go through `window.confirm`, from the
 * process table and from the port chip on a repo card (ATR-067). The native
 * dialog blocks the whole renderer, cannot be styled, and is announced
 * differently from every other confirmation in the app — while removing a
 * repo, moving a folder and creating one already asked through the Radix
 * dialog. Both call sites now ask through this.
 *
 * The confirm button is `variant="destructive"` when the action cannot be
 * undone by pressing the button again, and focus lands on Cancel, so the
 * default answer to a stray Enter is "no".
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role={destructive ? "alertdialog" : "dialog"}
        className="max-w-md"
        // A destructive prompt should not be dismissible by a stray click on
        // the backdrop; Escape and Cancel stay available.
        onInteractOutside={destructive ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            className={cn(pending && "cursor-wait")}
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
