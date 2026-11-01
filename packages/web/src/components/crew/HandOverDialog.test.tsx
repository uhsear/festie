import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrewMember } from '@festie/shared/types';
import HandOverDialog from './HandOverDialog';

const candidates = [
  { id: 'm1', userId: 'u2', name: 'Bob', username: 'bob' },
  { id: 'm2', userId: 'u3', name: 'Cara', username: 'cara' },
] as CrewMember[];

function setup(onConfirm = vi.fn()) {
  render(
    <HandOverDialog open onOpenChange={vi.fn()} crewName="Squad" candidates={candidates} onConfirm={onConfirm} />,
  );
  return onConfirm;
}

describe('HandOverDialog', () => {
  it('preselects the first candidate and confirms with its id', async () => {
    const onConfirm = setup();
    expect(screen.getByText('Who should own Squad?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Bob/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Hand over and leave' }));
    expect(onConfirm).toHaveBeenCalledWith('u2');
  });

  it('confirms with the picked candidate', async () => {
    const onConfirm = setup();
    await userEvent.click(screen.getByRole('radio', { name: /Cara/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand over and leave' }));
    expect(onConfirm).toHaveBeenCalledWith('u3');
  });
});
