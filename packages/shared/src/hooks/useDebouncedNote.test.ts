import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedNote, type UseDebouncedNoteArgs } from './useDebouncedNote';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useUIStore } from '../stores/uiStore';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const saveNote = vi.fn<(req: { festivalId: string; setId: string; note: string }) => Promise<void>>();

const base: UseDebouncedNoteArgs = {
  festivalId: 'f1',
  profileId: 'p1',
  noteKey: 'set-1',
  initialValue: 'old',
};

describe('useDebouncedNote', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
    useFestivalDataStore.setState({ saveNote });
    useUIStore.setState({ offlineMode: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves the last value once after the delay', async () => {
    const { result } = renderHook(() => useDebouncedNote(base));
    act(() => result.current.setValue('a'));
    act(() => result.current.setValue('ab'));
    expect(result.current.value).toBe('ab');
    expect(saveNote).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'set-1', note: 'ab' });
  });

  it('flushes a pending save on unmount before the delay ends', () => {
    const { result, unmount } = renderHook(() => useDebouncedNote(base));
    act(() => result.current.setValue('typed then closed'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    unmount();
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'set-1', note: 'typed then closed' });

    vi.advanceTimersByTime(1000);
    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending save on pagehide', () => {
    const { result } = renderHook(() => useDebouncedNote(base));
    act(() => result.current.setValue('x'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(saveNote).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'set-1', note: 'x' });
  });

  it('goes saving then saved', async () => {
    let resolve!: () => void;
    saveNote.mockImplementationOnce(() => new Promise<void>((r) => (resolve = r)));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useDebouncedNote({ ...base, onSaved }));
    expect(result.current.status).toBe('idle');

    act(() => result.current.setValue('x'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.status).toBe('saving');

    await act(async () => resolve());
    expect(result.current.status).toBe('saved');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('goes queued when offline', async () => {
    useUIStore.setState({ offlineMode: true });
    const { result } = renderHook(() => useDebouncedNote(base));
    act(() => result.current.setValue('x'));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.status).toBe('queued');
  });

  it('goes failed on reject, calls onError, and retry re-sends the latest value', async () => {
    const err = new Error('500');
    saveNote.mockRejectedValueOnce(err);
    const onError = vi.fn();
    const { result } = renderHook(() => useDebouncedNote({ ...base, onError }));
    act(() => result.current.setValue('keep me'));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.status).toBe('failed');
    expect(onError).toHaveBeenCalledWith(err);

    await act(async () => result.current.retry());
    expect(saveNote).toHaveBeenCalledTimes(2);
    expect(saveNote).toHaveBeenLastCalledWith({ festivalId: 'f1', setId: 'set-1', note: 'keep me' });
    expect(result.current.status).toBe('saved');
  });

  it('does not reset the value when the profile object refreshes with the same id', () => {
    const { result, rerender } = renderHook((props: UseDebouncedNoteArgs) => useDebouncedNote(props), {
      initialProps: base,
    });
    act(() => result.current.setValue('mid-typing'));
    rerender({ ...base, initialValue: 'server copy' });
    expect(result.current.value).toBe('mid-typing');
  });

  it('re-seeds on a new note key and saves the pending text under the old key', () => {
    const { result, rerender } = renderHook((props: UseDebouncedNoteArgs) => useDebouncedNote(props), {
      initialProps: base,
    });
    act(() => result.current.setValue('for set 1'));
    rerender({ ...base, noteKey: 'set-2', initialValue: 'set 2 note' });
    expect(saveNote).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'set-1', note: 'for set 1' });
    expect(result.current.value).toBe('set 2 note');
  });

  it('does not save without a festival or profile', () => {
    const { result, unmount } = renderHook(() => useDebouncedNote({ ...base, profileId: undefined }));
    act(() => result.current.setValue('x'));
    vi.advanceTimersByTime(500);
    unmount();
    expect(saveNote).not.toHaveBeenCalled();
  });
});
