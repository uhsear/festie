import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CrewSkeleton from './CrewSkeleton';

describe('CrewSkeleton', () => {
  it('announces loading as a status with sr-only text', () => {
    render(<CrewSkeleton />);
    expect(screen.getByRole('status', { name: 'Loading crew' })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading crew…')).toBeInTheDocument();
  });

  it('renders with aria-busy for loading state', () => {
    render(<CrewSkeleton />);
    expect(screen.getByLabelText('Loading crew')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a crew selector placeholder', () => {
    const { container } = render(<CrewSkeleton />);
    const selectorSkeleton = container.querySelector('.skeleton-shimmer.h-10.w-full.rounded-lg');
    expect(selectorSkeleton).toBeInTheDocument();
  });

  it('renders a home-base card placeholder', () => {
    const { container } = render(<CrewSkeleton />);
    const homeBase = container.querySelector('.skeleton-shimmer.h-24');
    expect(homeBase).toBeInTheDocument();
  });

  it('renders 7 tab placeholders in the tab row', () => {
    render(<CrewSkeleton />);
    expect(screen.getAllByTestId('crew-tab-chip')).toHaveLength(7);
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<CrewSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
