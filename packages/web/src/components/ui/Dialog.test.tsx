import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dialog from './Dialog';

function renderDialog(onOpenChange = vi.fn()) {
  return render(
    <Dialog open onOpenChange={onOpenChange} title="Rename crew" description="Pick a new name.">
      <button type="button">Inside</button>
    </Dialog>,
  );
}

function Harness({ dropTriggerOnOpen = false }: { dropTriggerOnOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const showTrigger = !(dropTriggerOnOpen && open);
  return (
    <>
      {showTrigger && (
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="Rename crew">
        <button type="button">Inside</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('carries the motion classes whose data-state rules animate enter and exit', () => {
    renderDialog();
    expect(screen.getByRole('dialog').className).toContain('dialog-content');
    expect(document.querySelector('.dialog-overlay')).not.toBeNull();
  });

  it('renders the title, description and children', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Rename crew' })).toBeInTheDocument();
    expect(screen.getByText('Pick a new name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument();
  });

  it('uses an opaque surface and an overlay level that stacks nested dialogs', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Rename crew' });
    expect(dialog.className).toContain('bg-bg-secondary');
    // The translucent card fill is wrong for a dialog; only the daylight theme swaps to the white card colour.
    expect(dialog.className).not.toMatch(/(^|\s)bg-bg-card/);
    expect(dialog.className).toContain('[:root[data-theme=daylight]_&]:bg-bg-card');
    const overlay = document.querySelector('[data-state="open"].fixed.inset-0');
    expect(overlay?.className).toContain('z-[var(--z-modal)]');
  });

  it('calls onOpenChange(false) on Escape', async () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    await userEvent.setup().keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hides the description visually, disables Close and shows the icon when asked', () => {
    render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        title="Send SOS"
        description="Alert the crew."
        hideDescription
        closeDisabled
        icon={<span data-testid="icon" />}
      >
        <span />
      </Dialog>,
    );
    expect(screen.getByText('Alert the crew.')).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Send SOS' })).toContainElement(screen.getByTestId('icon'));
  });

  it('has no structural a11y violations', async () => {
    renderDialog();
    await expect(screen.getByRole('dialog')).toBeAccessible();
  });

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
  });

  it('moves focus to body without an error when the trigger is gone', async () => {
    const user = userEvent.setup();
    const onError = vi.spyOn(console, 'error');
    render(<Harness dropTriggerOnOpen />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(document.body);
    expect(onError).not.toHaveBeenCalled();
    onError.mockRestore();
  });
});
