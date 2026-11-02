import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TimelineLegend from './TimelineLegend';

describe('TimelineLegend', () => {
  it('words the clash row as the shared grid hint', () => {
    const { container } = render(<TimelineLegend />);
    expect(container.textContent).toContain('Clashes with another of your picks');
  });
});
