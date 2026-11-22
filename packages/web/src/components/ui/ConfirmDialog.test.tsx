import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from './ConfirmDialog';
import { useReauthPrompt } from '../../hooks/useReauthPrompt';

describe('ConfirmDialog busy', () => {
  it('disables Cancel and ignores Escape while busy', async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete" onConfirm={() => {}} busy />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('closes on Escape when idle', async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete" onConfirm={() => {}} />);
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ConfirmDialog with a password prompt', () => {
  it('hides while the prompt is open so only one dialog shows', async () => {
    let ask: () => Promise<unknown>;
    function Harness() {
      const reauth = useReauthPrompt();
      ask = reauth.ask;
      return (
        <>
          <ConfirmDialog open onOpenChange={() => {}} title="Delete Fest?" onConfirm={() => {}} busy />
          {reauth.reauthDialog}
        </>
      );
    }
    render(<Harness />);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    act(() => {
      void ask();
    });
    expect(await screen.findByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByText('Delete Fest?')).not.toBeInTheDocument();
  });
});
