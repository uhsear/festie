import { AlertCircle, CheckCircle, Info, AlertTriangle, X, RotateCcw } from 'lucide-react';
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';

export default function Toast() {
  const { toasts, removeToast, pauseToast, resumeToast } = useToast();

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5" aria-hidden="true" />;
      case 'error':
        return <AlertCircle className="w-5 h-5" aria-hidden="true" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5" aria-hidden="true" />;
      default:
        return <Info className="w-5 h-5" aria-hidden="true" />;
    }
  };

  const getColorClasses = (type: string) => {
    switch (type) {
      case 'success':
        return 'text-accent-green bg-accent-green/10 border-accent-green/30';
      case 'error':
        return 'text-[var(--color-text-danger)] bg-accent-coral/10 border-accent-coral/30';
      case 'warning':
        return 'text-accent-amber bg-accent-amber/10 border-accent-amber/30';
      default:
        return 'text-accent-aqua bg-accent-aqua/10 border-accent-aqua/30';
    }
  };

  return (
    <div className="fixed bottom-[calc(var(--bottom-nav-h,0px)+16px+env(safe-area-inset-bottom,0px))] right-4 left-4 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none sm:left-auto sm:max-w-sm">
      {toasts.map((t) => {
        const isAlert = t.type === 'error' || t.type === 'warning';
        const roleAttr: { role: 'alert' | 'status' } = { role: isAlert ? 'alert' : 'status' };
        return (
          <div
            key={t.id}
            {...roleAttr}
            className={cn(
              'glass p-4 rounded-lg flex-between gap-3 pointer-events-auto toast-enter',
              getColorClasses(t.type),
            )}
            // An undo toast must not outlive its pending action's own timer, which
            // hover/focus cannot pause; so only plain toasts pause.
            onMouseEnter={t.onUndo ? undefined : () => pauseToast(t.id)}
            onMouseLeave={t.onUndo ? undefined : () => resumeToast(t.id)}
            onFocus={t.onUndo ? undefined : () => pauseToast(t.id)}
            onBlur={t.onUndo ? undefined : () => resumeToast(t.id)}
          >
            <div className="flex gap-3 items-start flex-1">
              {getIcon(t.type)}
              <div className="flex-1">
                <p className="text-sm font-medium">{t.message}</p>
              </div>
            </div>

            {t.onUndo && (
              <button
                type="button"
                onClick={() => {
                  t.onUndo?.();
                  removeToast(t.id);
                }}
                aria-label={`Undo: ${t.message}`}
                className="text-sm font-semibold underline-offset-2 hover:underline inline-flex items-center gap-1 min-h-11 min-w-11 px-2 flex-shrink-0"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                Undo
              </button>
            )}

            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="p-1 hover:bg-[var(--color-overlay-3)] rounded transition-colors flex-shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center"
              aria-label="Close"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
