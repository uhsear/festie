import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('lucide-react', () => {
  const Icon = () => <span data-testid="icon" />;
  return { CalendarPlus: Icon, X: Icon, Loader: Icon };
});

vi.mock('@festie/shared/stores', () => {
  const crewState = { reformCrew: vi.fn() };
  const festivalState = {
    festivals: [{ id: 'f-2', name: 'Other Fest' }],
    loadFestivals: vi.fn().mockResolvedValue(undefined),
  };
  return {
    useCrewStore: (selector: (s: typeof crewState) => unknown) => selector(crewState),
    useFestivalDataStore: (selector: (s: typeof festivalState) => unknown) => selector(festivalState),
  };
});

vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

import ReformCrewButton from './ReformCrewButton';

describe('ReformCrewButton dialog', () => {
  it('opens named "Reform crew" with the target select, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<ReformCrewButton crewId="crew-1" sourceFestivalId="f-1" crewName="Squad" />);

    await user.click(screen.getByRole('button', { name: /reform this crew for another festival/i }));
    expect(screen.getByRole('dialog', { name: 'Reform crew' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Target festival' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
