import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton, { SkeletonGroup } from './Skeleton';

describe('Skeleton', () => {
  it('renders with default text variant', () => {
    render(<Skeleton />);
    const el = screen.getByLabelText('Loading');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el.className).toContain('h-4');
    expect(el.className).toContain('w-full');
  });

  it('renders with circle variant', () => {
    render(<Skeleton variant="circle" />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('rounded-full');
    expect(el.className).toContain('w-10');
    expect(el.className).toContain('h-10');
  });

  it('renders with card variant', () => {
    render(<Skeleton variant="card" />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('h-32');
    expect(el.className).toContain('rounded-xl');
  });

  it('renders with header variant', () => {
    render(<Skeleton variant="header" />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('h-8');
    expect(el.className).toContain('mb-4');
  });

  it('applies custom className', () => {
    render(<Skeleton className="my-custom-class" />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('my-custom-class');
  });

  it('always marks aria-busy as true for accessibility', () => {
    render(<Skeleton />);
    const el = screen.getByLabelText('Loading');
    expect(el).toHaveAttribute('aria-busy', 'true');
  });

  it('renders as a div element', () => {
    render(<Skeleton />);
    const el = screen.getByLabelText('Loading');
    expect(el.tagName).toBe('DIV');
  });

  it('includes skeleton-shimmer base class for all variants', () => {
    const { rerender } = render(<Skeleton variant="text" />);
    expect(screen.getByLabelText('Loading').className).toContain('skeleton-shimmer');

    rerender(<Skeleton variant="circle" />);
    expect(screen.getByLabelText('Loading').className).toContain('skeleton-shimmer');

    rerender(<Skeleton variant="card" />);
    expect(screen.getByLabelText('Loading').className).toContain('skeleton-shimmer');

    rerender(<Skeleton variant="header" />);
    expect(screen.getByLabelText('Loading').className).toContain('skeleton-shimmer');
  });

  describe('SkeletonGroup', () => {
    it('announces one loading status for all its skeletons', () => {
      render(
        <SkeletonGroup className="px-4">
          <Skeleton />
          <Skeleton variant="card" />
          <Skeleton variant="circle" />
        </SkeletonGroup>,
      );
      const statuses = screen.getAllByRole('status');
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toHaveAccessibleName('Loading');
      expect(statuses[0]).toHaveAttribute('aria-busy', 'true');
      expect(statuses[0]).toHaveClass('px-4');
    });

    it('hides the grouped skeletons from assistive technology but keeps their look', () => {
      const { container } = render(
        <SkeletonGroup>
          <Skeleton variant="card" />
        </SkeletonGroup>,
      );
      const child = container.querySelector('.skeleton-shimmer');
      expect(child).toHaveAttribute('aria-hidden', 'true');
      expect(child).not.toHaveAttribute('role');
      expect(child?.className).toContain('h-32');
    });
  });
});
