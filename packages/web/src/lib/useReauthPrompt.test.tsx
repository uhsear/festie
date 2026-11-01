import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReauthPrompt } from './useReauthPrompt';

let ask: () => Promise<string | null>;

function Harness() {
  const { askPassword, reauthDialog } = useReauthPrompt();
  ask = askPassword;
  return <>{reauthDialog}</>;
}

describe('useReauthPrompt', () => {
  it('resolves with the typed password, untrimmed', async () => {
    render(<Harness />);
    let result: Promise<string | null>;
    act(() => {
      result = ask();
    });
    await userEvent.type(await screen.findByPlaceholderText('Password'), ' hunter2 ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(result!).resolves.toBe(' hunter2 ');
  });

  it('resolves null on cancel', async () => {
    render(<Harness />);
    let result: Promise<string | null>;
    act(() => {
      result = ask();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(result!).resolves.toBeNull();
  });
});
