import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RovingGroup from './RovingGroup';

function Radios() {
  const [value, setValue] = useState('a');
  return (
    <RovingGroup itemRole="radio" role="radiogroup" aria-label="Group by">
      {['a', 'b', 'c'].map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => setValue(v)}>
          {v}
        </button>
      ))}
    </RovingGroup>
  );
}

describe('RovingGroup', () => {
  it('gives a radiogroup one tab stop, on the checked radio', () => {
    render(<Radios />);
    const tabIndexes = screen.getAllByRole('radio').map((r) => r.tabIndex);
    expect(tabIndexes).toEqual([0, -1, -1]);
  });

  it('moves the selection and the tab stop with the arrow keys', () => {
    render(<Radios />);
    screen.getByRole('radio', { name: 'a' }).focus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'a' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'b' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'b' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'b' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('radio', { name: 'a' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'c' })).toHaveAttribute('aria-checked', 'true');
  });
});
