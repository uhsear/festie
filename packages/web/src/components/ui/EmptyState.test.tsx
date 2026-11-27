import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No picks yet" />);
    expect(screen.getByText('No picks yet')).toBeInTheDocument();
  });

  it('renders the title as h2 so it follows a page h1 without skipping a level', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Empty');
  });

  it('balances the title and description lines so a short title never leaves one orphan word', () => {
    render(<EmptyState title="This festival isn't mapped yet" description="Add a location to see it here." />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('text-balance');
    expect(screen.getByText('Add a location to see it here.')).toHaveClass('text-pretty');
  });

  it('compact drops the illustration and the 200px floor but keeps the icon', () => {
    const { container } = render(<EmptyState title="No meeting points yet" illustration="emptyList" compact />);
    expect(container.querySelector('.empty-state-illustration')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('min-h-0');
    expect(container.firstElementChild).not.toHaveClass('min-h-[200px]');
  });

  it('keeps the illustration and the 200px floor by default', () => {
    const { container } = render(<EmptyState title="No picks yet" illustration="emptyList" />);
    expect(container.querySelector('.empty-state-illustration')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('min-h-[200px]');
  });

  it('renders the title as h1 when the empty state is the whole page', () => {
    render(<EmptyState title="Empty" headingLevel={1} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Empty');
  });

  it('renders description when provided', () => {
    render(
      <EmptyState title="Empty" description="Start by browsing the schedule" />,
    );
    expect(screen.getByText('Start by browsing the schedule')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
  });

  it('renders icon when provided', () => {
    render(
      <EmptyState
        title="Empty"
        icon={<span data-testid="empty-icon">star</span>}
      />,
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('does not render icon section when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('.text-text-muted')).not.toBeInTheDocument();
  });

  it('renders CTA button when provided', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        cta={{ label: 'Browse Schedule', onClick }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Browse Schedule' })).toBeInTheDocument();
  });

  it('fires CTA onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        cta={{ label: 'Go', onClick }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render CTA button when not provided', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<EmptyState title="Empty" className="mt-8" />);
    expect(container.firstElementChild?.className).toContain('mt-8');
  });

  it('centers content', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const el = container.firstElementChild;
    expect(el?.className).toContain('items-center');
    expect(el?.className).toContain('text-center');
  });

  it('renders a secondary CTA that calls its handler', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        cta={{ label: 'Create', onClick: vi.fn() }}
        secondaryCta={{ label: 'Join', onClick }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('draws the illustration in the shared 160 by 112 slot and keeps an icon fallback', () => {
    const { container } = render(
      <EmptyState title="Empty" illustration="noPicks" icon={<span data-testid="empty-icon" />} />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(img).toHaveStyle({ width: '160px', height: '112px' });
    expect(container.querySelector('.empty-state-fallback-icon')).toContainElement(screen.getByTestId('empty-icon'));
  });

  it('falls back to a default icon when an illustration has no icon prop', () => {
    const { container } = render(<EmptyState title="Empty" illustration="noCrew" />);
    expect(container.querySelector('.empty-state-fallback-icon svg')).not.toBeNull();
  });
});

describe('EmptyState ghost row', () => {
  it.each([
    ['picks', ['Artist name', 'Must', 'Want', 'Maybe']],
    ['crew', ['Your friend', 'Member']],
    ['inbox', ['Notifications']],
  ] as const)('draws the %s ghost row with product labels and no illustration', (kind, labels) => {
    const { container } = render(<EmptyState title="Empty" ghostRow={kind} illustration="noPicks" />);
    const row = screen.getByTestId('ghost-row');
    for (const label of labels) expect(row).toHaveTextContent(label);
    expect(container.querySelector('.empty-state-illustration')).not.toBeInTheDocument();
  });

  it('has no structural a11y violations', async () => {
    const { container } = render(<EmptyState title="No picks yet" description="Browse." ghostRow="picks" />);
    await expect(container).toBeAccessible();
  });
});
