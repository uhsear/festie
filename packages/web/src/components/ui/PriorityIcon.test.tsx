import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Priority } from '@festie/shared/types';
import PriorityIcon, { priorityLucide } from './PriorityIcon';

describe('PriorityIcon', () => {
  it('falls back to the want-to-see glyph for a NULL legacy priority', () => {
    const legacy = null as unknown as Priority;
    expect(priorityLucide(legacy)).toBe(priorityLucide('want-to-see'));
    const { container } = render(<PriorityIcon priority={legacy} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
