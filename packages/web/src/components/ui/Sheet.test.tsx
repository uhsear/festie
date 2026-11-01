import { useState } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sheet from './Sheet';

// jsdom has no pointer capture; vaul calls it on pointerdown inside the sheet.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe('Sheet', () => {
  it('renders the title and children', () => {
    render(
      <Sheet open onOpenChange={vi.fn()} title="Pending changes">
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Pending changes' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Close is pressed', async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Pending changes">
        <p>Body</p>
      </Sheet>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('returns focus to the opener on Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Sheet open={open} onOpenChange={setOpen} title="Pending changes">
            <p>Body</p>
          </Sheet>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
  });
});
