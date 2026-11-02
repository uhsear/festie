import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface UIState {
  /** Mobile-only bottom-sheet visibility (e.g. set detail). */
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

const UIContext = createContext<UIState | null>(null);

/**
 * Mobile-only UI slice (sheet visibility; the schedule view now lives in the
 * shared `festivalUIStore`, per festival). React context rather
 * than Zustand — zustand isn't a direct mobile dependency, and this state is
 * purely presentational and app-local.
 */
export function UIProvider({ children }: { children: ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const value = useMemo<UIState>(
    () => ({
      sheetOpen,
      openSheet: () => setSheetOpen(true),
      closeSheet: () => setSheetOpen(false),
    }),
    [sheetOpen],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return ctx;
}
