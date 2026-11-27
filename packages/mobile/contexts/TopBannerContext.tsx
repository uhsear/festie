import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useFocusEffect } from 'expo-router';

// Two contexts so the root, which only writes, does not re-render when the height changes.
const HeightContext = createContext(0);
const SetHeightContext = createContext<(height: number) => void>(() => {});
// How many focused screen headers pad below the overlay; the native stack headers never do.
const HeaderCountContext = createContext(0);
const SetHeaderCountContext = createContext<(delta: number) => void>(() => {});

/**
 * Height of the root top overlay (OfflineBanner, SosBanner, AnnouncementBanner), status-bar
 * inset included, or 0 while no bar shows. The overlay floats over the screen, so a screen
 * header reads this to start below it instead of sitting under it.
 */
export function TopBannerProvider({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(0);
  const [headerCount, setHeaderCount] = useState(0);
  const addHeaders = useCallback((delta: number) => setHeaderCount((n) => n + delta), []);
  return (
    <SetHeightContext.Provider value={setHeight}>
      <SetHeaderCountContext.Provider value={addHeaders}>
        <HeightContext.Provider value={height}>
          <HeaderCountContext.Provider value={headerCount}>{children}</HeaderCountContext.Provider>
        </HeightContext.Provider>
      </SetHeaderCountContext.Provider>
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
 * A screen header calls this: while its screen is focused, the overlay may grow to a 44 pt tap
 * target, because this header starts below the overlay. A native stack header starts at the status-bar
 * inset and does not call it, so the overlay stays one line there and covers only a sliver of the bar.
 */
export function useRegisterPaddedHeader(): void {
  const addHeaders = useContext(SetHeaderCountContext);
  useFocusEffect(
    useCallback(() => {
      addHeaders(1);
      return () => addHeaders(-1);
    }, [addHeaders]),
  );
}

/** True while a focused screen header pads below the overlay (see useRegisterPaddedHeader). */
export function useHeaderPadsBelowBanner(): boolean {
  return useContext(HeaderCountContext) > 0;
}

/**
 * Top padding for a screen header. With no overlay it owns the status-bar inset itself
 * (`inset + rest`); with one it starts `gap` below the overlay, which already holds the inset.
 */
export function headerTopPadding(inset: number, rest: number, overlayHeight: number, gap: number): number {
  return Math.max(inset + rest, overlayHeight > 0 ? overlayHeight + gap : 0);
}
