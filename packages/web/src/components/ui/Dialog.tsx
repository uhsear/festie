import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import { useReturnFocus } from '../../hooks/useReturnFocus';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * The one centred modal shell. Radix supplies the focus trap, Escape,
 * aria-modal and portal; useReturnFocus restores focus. ConfirmDialog, PromptDialog and the
 * account modals all render through it so they open, close and trap alike.
 */
export default function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  const returnFocus = useReturnFocus();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <RadixDialog.Content
          {...returnFocus}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[92vw] max-w-sm max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2
                     rounded-2xl bg-bg-card border border-border-light shadow-2xl p-5 space-y-4
                     data-[state=open]:animate-in data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <RadixDialog.Title className="text-base font-bold text-text-primary">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-sm text-text-secondary">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-5 h-5" />} />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
