import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WrapSkeleton from './WrapSkeleton';

describe('WrapSkeleton', () => {
  it('renders with aria-busy for loading state', () => {
    render(<WrapSkeleton />);
    expect(screen.getByLabelText('Loading wrap')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders one poster block', () => {
    render(<WrapSkeleton />);
    expect(screen.getAllByTestId('wrap-poster')).toHaveLength(1);
  });

  it('uses skeleton class for placeholder blocks', () => {
    const { container } = render(<WrapSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
