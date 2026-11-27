import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LazyMotion, domAnimation } from 'motion/react';
import ConfettiBurst from './ConfettiBurst';

describe('ConfettiBurst', () => {
  it('renders inside LazyMotion strict without the motion-component invariant', () => {
    render(
      <LazyMotion features={domAnimation} strict>
        <ConfettiBurst />
      </LazyMotion>,
    );
    expect(screen.getByTestId('confetti').children).toHaveLength(24);
  });
});
