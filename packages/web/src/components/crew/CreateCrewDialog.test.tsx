import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  create: vi.fn(),
}));

vi.mock('@festie/shared/stores', () => ({
  useCrewStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(h.state),
    { getState: () => ({ error: null }) },
  ),
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(h.state),
}));
vi.mock('@festie/shared/hooks', () => ({ useCreateCrew: () => h.create }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

import CreateCrewDialog from './CreateCrewDialog';

const edc = { id: 'f1', name: 'EDC Orlando', startDate: '2099-11-06', endDate: '2099-11-08' };
const bonnaroo = { id: 'f2', name: 'Bonnaroo', startDate: '2099-06-12', endDate: '2099-06-15' };

function setState(overrides: Record<string, unknown> = {}) {
  h.state = {
    festivals: [edc],
    currentFestival: edc,
    loadFestivals: vi.fn().mockResolvedValue(undefined),
    crews: [],
    ...overrides,
  };
}

describe('CreateCrewDialog', () => {
  beforeEach(() => {
    h.create.mockReset().mockResolvedValue({ id: 'c1' });
    setState();
  });

  it('is disabled with no festival and says why', () => {
    setState({ festivals: [], currentFestival: null });
    render(<CreateCrewDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Pick a festival first. A crew belongs to one festival.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create crew' })).toBeDisabled();
  });

  it('is disabled at the cap and shows the cap text', async () => {
    const crews = [1, 2, 3].map((i) => ({ id: `c${i}`, name: `C${i}`, festivalId: 'f1' }));
    setState({ crews });
    render(<CreateCrewDialog open onOpenChange={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Crew name'), 'Fourth');
    expect(screen.getByText("You're in 3 of 3 crews for this festival. Leave one to start another.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create crew' })).toBeDisabled();
  });

  it('submits with the festival line and the chosen festival id', async () => {
    const onOpenChange = vi.fn();
    render(<CreateCrewDialog open onOpenChange={onOpenChange} />);
    expect(screen.getByText('For EDC Orlando 2099')).toBeInTheDocument();
    expect(screen.queryByLabelText('Festival')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Crew name'), 'Sunset Squad');
    await userEvent.click(screen.getByRole('button', { name: 'Create crew' }));
    expect(h.create).toHaveBeenCalledWith('Sunset Squad', 'f1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the festival select with two choices and submits the picked one', async () => {
    setState({ festivals: [edc, bonnaroo] });
    render(<CreateCrewDialog open onOpenChange={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Festival'), 'f2');
    await userEvent.type(screen.getByLabelText('Crew name'), 'Farm Crew');
    await userEvent.click(screen.getByRole('button', { name: 'Create crew' }));
    expect(h.create).toHaveBeenCalledWith('Farm Crew', 'f2');
  });
});
