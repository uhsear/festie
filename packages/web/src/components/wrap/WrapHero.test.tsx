import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WrapHero from './WrapHero';

describe('WrapHero', () => {
  it('exposes the value, label and detail as readable text', () => {
    const { container } = render(<WrapHero value={42} label="sets rated" detail="3 stages" />);
    expect(container.querySelector('p')?.hasAttribute('aria-label')).toBe(false);
    expect(screen.getByText('42', { selector: '.sr-only' })).toBeTruthy();
    expect(screen.getByText('sets rated · 3 stages')).toBeTruthy();
  });
});
