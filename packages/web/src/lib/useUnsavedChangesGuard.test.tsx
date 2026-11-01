import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createRouter, createRootRoute, createMemoryHistory } from '@tanstack/react-router';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

function renderHarness(dirty: boolean, action: () => void) {
  function Harness() {
    const { confirmLeave, guardDialog } = useUnsavedChangesGuard(dirty);
    return (
      <>
        <button onClick={() => confirmLeave(action)}>Leave</button>
        {guardDialog}
      </>
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Harness }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('useUnsavedChangesGuard', () => {
  it('runs the action at once when clean', async () => {
    const action = vi.fn();
    renderHarness(false, action);
    await userEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard changes?')).toBeNull();
  });

  it('asks first when dirty and runs the action on Discard', async () => {
    const action = vi.fn();
    renderHarness(true, action);
    await userEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(action).not.toHaveBeenCalled();
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
