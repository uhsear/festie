import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import Button from './Button';
import Dialog from './Dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}

/**
 * Styled confirmation modal built on the shared Dialog shell — mirrors
 * PromptDialog without the text input. Used for destructive actions
 * (leave/delete crew) so they get focus-trap, Escape handling, and
 * consistent styling instead of the unstyled native window.confirm.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  busy = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex gap-2">
        <RadixDialog.Close asChild>
          <Button variant="secondary" type="button" className="flex-1 min-h-11">
            {cancelLabel}
          </Button>
        </RadixDialog.Close>
        <Button
          type="button"
          variant={destructive ? 'danger' : 'primary'}
          isLoading={busy}
          disabled={busy}
          onClick={() => onConfirm()}
          className="flex-1 min-h-11"
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
