import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const festivalState = {
  currentFestival: { id: 'f1' },
  days: [{ id: 'd1', label: 'Fri', date: '2026-05-29' }],
  stages: [{ id: 'st1', name: 'Main' }],
};
const setDetailSet = vi.fn();
let result: { sets: unknown[]; status: string } = { sets: [], status: 'idle' };
const hook = vi.fn((_f?: string, _s?: string) => result);

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: typeof festivalState) => unknown) => sel(festivalState),
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (sel: (s: { setDetailSet: typeof setDetailSet }) => unknown) => sel({ setDetailSet }),
}));
vi.mock('@festie/shared/hooks', () => ({ useAlsoPicked: (f?: string, s?: string) => hook(f, s) }));

import AlsoPickedSection from './AlsoPickedSection';

const current = { id: 's0', artists: [{ name: 'Current' }] } as never;
const other = { id: 's1', artists: [{ name: 'Other' }], dayIndex: 0, stageId: 'st1', startTime: null };

describe('AlsoPickedSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    result = { sets: [other], status: 'ready' };
  });

  it('asks for the current set, lists the sets and opens one', async () => {
    render(<AlsoPickedSection set={current} />);
    expect(hook).toHaveBeenCalledWith('f1', 's0');
    expect(screen.getByRole('heading', { name: 'People who picked this also picked' })).toBeInTheDocument();
    expect(screen.getByText('Fri · Main')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Other/ }));
    expect(setDetailSet).toHaveBeenCalledWith(other);
  });

  it.each(['idle', 'loading', 'error'])('renders nothing while %s', (status) => {
    result = { sets: [other], status };
    const { container } = render(<AlsoPickedSection set={current} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when ready with no sets', () => {
    result = { sets: [], status: 'ready' };
    const { container } = render(<AlsoPickedSection set={current} />);
    expect(container).toBeEmptyDOMElement();
  });
});
