import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PullRefreshIndicator from './PullRefreshIndicator';

describe('PullRefreshIndicator', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<PullRefreshIndicator progress={0} isRefreshing={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the pull state while pulling', async () => {
    render(<PullRefreshIndicator progress={0.5} isRefreshing={false} />);
    const status = screen.getByRole('status', { name: 'Pull to refresh' });
    await expect(status).toBeAccessible();
  });

  it('announces refreshing, even at zero progress', () => {
    render(<PullRefreshIndicator progress={0} isRefreshing />);
    expect(screen.getByRole('status', { name: 'Refreshing content' })).toBeInTheDocument();
  });
});
