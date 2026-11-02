import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CrewPlanSkeleton from './CrewPlanSkeleton';

describe('CrewPlanSkeleton', () => {
  it('announces loading as a status with sr-only text', () => {
    render(<CrewPlanSkeleton />);
    expect(screen.getByRole('status', { name: 'Loading crew plan' })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading crew plan…')).toBeInTheDocument();
  });

  it('has aria-busy and the loading label', () => {
    render(<CrewPlanSkeleton />);
    expect(screen.getByLabelText('Loading crew plan')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders 4 list rows', () => {
    render(<CrewPlanSkeleton />);
    expect(screen.getAllByTestId('crew-plan-row')).toHaveLength(4);
  });
});
