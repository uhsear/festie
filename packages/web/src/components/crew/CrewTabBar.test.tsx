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
