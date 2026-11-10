import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useHaptics } from './useHaptics';

const AXIS_LOCK_PX = 8;
const PROGRESS_LEVELS = 20;

export interface UsePullToRefreshReturn {
  pullProgress: number;
  isRefreshing: boolean;
  bind: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchCancel: (e: React.TouchEvent) => void;
  };
}

export interface UsePullToRefreshProps {
  /**
   * Threshold in pixels to trigger refresh (default: 80)
   */
  threshold?: number;
  /**
   * Time in milliseconds to auto-reset after refresh (default: 1500)
   */
  resetDelay?: number;
  /**
   * Query keys to invalidate on refresh
   */
  queryKeys?: readonly unknown[][];
}

/**
 * Pull-to-refresh hook for TanStack Query
 * Detects pull-down gesture when scrolled to top and invalidates queries
 * Includes haptic feedback on trigger and visual progress indicator
 *
 * @param props - Configuration object
 * @param props.threshold - Pixel distance to trigger refresh (default: 80)
 * @param props.resetDelay - Time before auto-reset (default: 1500ms)
 * @param props.queryKeys - Query keys to invalidate (default: invalidates all)
 * @returns Object with pull progress (0-1), refresh state, and touch event handlers
 *
 * @example
 * const { pullProgress, isRefreshing, bind } = usePullToRefresh({
 *   threshold: 80,
 *   queryKeys: [['sets'], ['festival']],
 * });
 * return (
 *   <div {...bind} className="overscroll-none">
 *     {pullProgress > 0 && <RefreshIndicator progress={pullProgress} />}
 *   </div>
 * );
 */
export function usePullToRefresh({
  threshold = 80,
  resetDelay = 1500,
  queryKeys = [],
}: UsePullToRefreshProps = {}): UsePullToRefreshReturn {
  const queryClient = useQueryClient();
  const { success } = useHaptics();

  const [pullProgress, setPullProgress] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  // idle: not armed; armed: finger down, direction undecided; pulling: vertical lock
  const phaseRef = useRef<'idle' | 'armed' | 'pulling'>('idle');
  const lastProgressRef = useRef(0);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Render at most ~20 times per pull instead of once per touchmove
  const publishProgress = useCallback((progress: number) => {
    const stepped = Math.round(progress * PROGRESS_LEVELS) / PROGRESS_LEVELS;
    if (stepped === lastProgressRef.current) return;
    lastProgressRef.current = stepped;
    setPullProgress(stepped);
  }, []);

  const cancelGesture = useCallback(() => {
    if (phaseRef.current === 'idle') return;
    phaseRef.current = 'idle';
    publishProgress(0);
  }, [publishProgress]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    phaseRef.current = 'idle';
    // An inner scroller that is scrolled owns the gesture, as does the wrapper itself
    const wrapper = e.currentTarget as Element;
    for (let el = e.target as Element | null; el; el = el.parentElement) {
      if (el.scrollTop !== 0) return;
      if (el === wrapper) break;
    }

    const touch = e.touches[0];
    startXRef.current = touch?.clientX || 0;
    startYRef.current = touch?.clientY || 0;
    currentYRef.current = startYRef.current;
    phaseRef.current = 'armed';
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (phaseRef.current === 'idle') return;

    const touch = e.touches[0];
    const dx = (touch?.clientX || 0) - startXRef.current;
    const dy = (touch?.clientY || 0) - startYRef.current;

    if (phaseRef.current === 'armed') {
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
      // Horizontal or upward drags belong to the content, not to refresh
      if (Math.abs(dx) > Math.abs(dy) || dy <= 0) {
        phaseRef.current = 'idle';
        return;
      }
      phaseRef.current = 'pulling';
    }

    currentYRef.current = startYRef.current + dy;
    publishProgress(Math.min(Math.max(0, dy) / threshold, 1));
  }, [threshold, publishProgress]);

  const handleTouchEnd = useCallback(() => {
    const wasPulling = phaseRef.current === 'pulling';
    phaseRef.current = 'idle';
    if (!wasPulling) return;

    const distance = Math.max(0, currentYRef.current - startYRef.current);

    // Trigger refresh if threshold met
    if (distance >= threshold) {
      setIsRefreshing(true);
      lastProgressRef.current = 1;
      setPullProgress(1);
      success(); // Haptic feedback

      // Invalidate queries
      if (queryKeys.length > 0) {
        queryKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      } else {
        // Invalidate all queries if no specific keys provided
        queryClient.invalidateQueries();
      }

      // Auto-reset after delay
      resetTimeoutRef.current = setTimeout(() => {
        setIsRefreshing(false);
        lastProgressRef.current = 0;
        setPullProgress(0);
      }, resetDelay);
    } else {
      // Reset if threshold not met
      publishProgress(0);
    }
  }, [threshold, queryKeys, queryClient, success, resetDelay, publishProgress]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  return {
    pullProgress,
    isRefreshing,
    bind: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: cancelGesture,
    },
  };
}
