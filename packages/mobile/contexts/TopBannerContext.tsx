import { createContext, useContext, useState, type ReactNode } from 'react';

// Two contexts so the root, which only writes, does not re-render when the height changes.
const HeightContext = createContext(0);
const SetHeightContext = createContext<(height: number) => void>(() => {});

/**
 * Height of the root top overlay (OfflineBanner, SosBanner, AnnouncementBanner), status-bar
 * inset included, or 0 while no bar shows. The overlay floats over the screen, so a screen
 * header reads this to start below it instead of sitting under it.
 */
export function TopBannerProvider({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(0);
  return (
    <SetHeightContext.Provider value={setHeight}>
      <HeightContext.Provider value={height}>{children}</HeightContext.Provider>
    </SetHeightContext.Provider>
  );
}

export function useTopBannerHeight(): number {
  return useContext(HeightContext);
}

export function useSetTopBannerHeight(): (height: number) => void {
  return useContext(SetHeightContext);
}

/**
 * Top padding for a screen header. With no overlay it owns the status-bar inset itself
 * (`inset + rest`); with one it starts `gap` below the overlay, which already holds the inset.
 */
export function headerTopPadding(inset: number, rest: number, overlayHeight: number, gap: number): number {
  return Math.max(inset + rest, overlayHeight > 0 ? overlayHeight + gap : 0);
}
