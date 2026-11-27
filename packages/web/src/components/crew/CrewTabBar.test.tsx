import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CrewTabBar from './CrewTabBar';

describe('CrewTabBar', () => {
  it('renders Find, Members, Plan, Money in order', () => {
    render(<CrewTabBar activeTab="find" onTabChange={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Find', 'Members', 'Plan', 'Money']);
    expect(screen.getByRole('tab', { name: 'Find' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders a count badge on plan', () => {
    render(<CrewTabBar activeTab="find" onTabChange={() => {}} badges={{ plan: 3 }} />);
    expect(screen.getByRole('tab', { name: /Plan/ })).toHaveTextContent('3');
  });

  it('calls onTabChange with money', () => {
    const onTabChange = vi.fn();
    render(<CrewTabBar activeTab="find" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Money' }));
    expect(onTabChange).toHaveBeenCalledWith('money');
  });
});

describe('CrewTabBar layout', () => {
  it('spans the page gutter as four equal columns, so no tab hides at a narrow width', () => {
    render(<CrewTabBar activeTab="find" onTabChange={() => {}} />);
    const list = screen.getByRole('tablist');
    expect(list).toHaveClass('grid', 'grid-cols-4', 'w-full');
    expect(list.className).not.toMatch(/\bpx-\d/);
  });

  it('keeps every tab at the 44px touch height', () => {
    render(<CrewTabBar activeTab="find" onTabChange={() => {}} />);
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('min-h-11');
  });
});
