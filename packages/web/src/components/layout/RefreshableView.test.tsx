import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePullToRefresh = vi.fn();
vi.mock('../../hooks/usePullToRefresh', () => ({
  usePullToRefresh: (opts: unknown) => usePullToRefresh(opts),
}));

import RefreshableView from './RefreshableView';

describe('RefreshableView', () => {
  it('renders children, applies className and passes threshold and queryKeys to the hook', () => {
    usePullToRefresh.mockReturnValue({ pullProgress: 0, isRefreshing: false, bind: {} });
    render(
      <RefreshableView queryKeys={[['sets']]} className="extra">
        <p>Lineup</p>
      </RefreshableView>,
    );
    expect(screen.getByText('Lineup').parentElement).toHaveClass('overflow-y-auto', 'extra');
    expect(usePullToRefresh).toHaveBeenCalledWith({ threshold: 80, queryKeys: [['sets']] });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the refresh indicator while refreshing', () => {
    usePullToRefresh.mockReturnValue({ pullProgress: 0, isRefreshing: true, bind: {} });
    render(<RefreshableView>x</RefreshableView>);
    expect(screen.getByRole('status', { name: 'Refreshing content' })).toBeInTheDocument();
  });
});
