import { create } from 'zustand';
import type { ArtistSheetTarget } from '../utils/artistSheet';

interface ArtistSheetState {
  /** The last artist opened. It stays after close so the sheet keeps its content through the exit animation. */
  target: ArtistSheetTarget | null;
  isOpen: boolean;
  open: (target: ArtistSheetTarget) => void;
  close: () => void;
}

/** The one artist sheet's state. One host per app renders it; every artist name calls `open`. */
export const useArtistSheetStore = create<ArtistSheetState>()((set) => ({
  target: null,
  isOpen: false,
  open: (target) => set({ target, isOpen: true }),
  close: () => set({ isOpen: false }),
}));
