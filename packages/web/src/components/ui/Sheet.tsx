import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import { cn } from '../../lib/utils';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Leading image beside the title (for example an app icon). */
  icon?: ReactNode;
  /** Non-modal sheets have no scrim and let taps through to the page behind. Default true. */
  modal?: boolean;
  /** Overrides what the header Close button does. Defaults to onOpenChange(false). */
  onCloseClick?: () => void;
  /** Extra classes on the sheet panel, for example a desktop layout. */
  className?: string;
}

/**
 * The one bottom-sheet shell, built on vaul: drag handle, drag-to-dismiss,
 * Escape, focus trap (when modal) and focus return. PendingSyncSheet and
 * IOSInstallSheet render through it. DetailPanel keeps its own drawer.
 */
export default function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  icon,
  modal = true,
  onCloseClick,
  className,
}: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible modal={modal}>
      <Drawer.Portal>
        {modal && <Drawer.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/50 backdrop-blur-sm" />}
        <Drawer.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed bottom-0 inset-x-0 z-[var(--z-modal)] rounded-t-2xl bg-bg-primary border-t border-border-light',
            'shadow-2xl p-5 pb-8 space-y-4 max-h-[90vh] overflow-y-auto flex flex-col outline-none',
            className,
          )}
        >
          {/* Drag handle: visual affordance, vaul does the physics. Hidden on desktop. */}
          <div className="mx-auto -mt-2 mb-2 h-1.5 w-12 rounded-full bg-text-muted/30 flex-shrink-0 lg:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {icon}
              <div>
                <Drawer.Title className="text-base font-bold text-text-primary">{title}</Drawer.Title>
                {description && (
                  <Drawer.Description className="text-xs text-text-secondary mt-0.5">{description}</Drawer.Description>
                )}
              </div>
            </div>
            <IconButton
              label="Close"
              icon={<X className="w-5 h-5" />}
              onClick={onCloseClick ?? (() => onOpenChange(false))}
              className="flex-shrink-0"
            />
          </div>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
