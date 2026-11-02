import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ---------------------------------------------------------------

// Stub the lucide icons used by ProfileSection AND by the shared Button it
// renders (Button shows a <Loader> while isLoading). Each becomes a span with
// a name-derived data-testid.
vi.mock('lucide-react', () => {
  const stubIcon = (name: string) => () => <span data-testid={`${name}-icon`} />;
  return {
    AtSign: stubIcon('AtSign'),
    User: stubIcon('User'),
    Loader: stubIcon('Loader'),
  };
});

// authStore is consumed via selectors: useAuthStore((s) => s.x).
const mockUpdateDisplayName = vi.fn().mockResolvedValue(undefined);

let authState: Record<string, unknown>;

function resetAuth(overrides: Record<string, unknown> = {}) {
  authState = {
    user: { id: 'u1', name: 'Ada Lovelace', username: 'ada' },
    updateDisplayName: mockUpdateDisplayName,
    ...overrides,
  };
}

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(authState),
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

import ProfileSection from './ProfileSection';

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateDisplayName.mockResolvedValue(undefined);
  resetAuth();
});

describe('ProfileSection — rendering', () => {
  it('renders the display-name input pre-filled with the current name', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Ada Lovelace');
  });

  it('shows the read-only @username and the immutable hint', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    expect(screen.getByText('@ada')).toBeInTheDocument();
    expect(screen.getByText(/username can’t be changed/)).toBeInTheDocument();
    // There is no input for the username — it is display-only text.
    expect(screen.queryByDisplayValue('ada')).not.toBeInTheDocument();
  });

  it('omits the @username block when no username is present', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace' }} />);
    expect(screen.queryByText(/username can’t be changed/)).not.toBeInTheDocument();
  });

  it('renders the Display name heading and no avatar card', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    expect(screen.getByText('Display name')).toBeInTheDocument();
    expect(screen.queryByText('Avatar')).not.toBeInTheDocument();
  });
});

describe('ProfileSection — display name submission', () => {
  it('calls updateDisplayName with the trimmed new name', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, '  Grace Hopper  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateDisplayName).toHaveBeenCalledWith('Grace Hopper');
  });

  it('shows a success toast after saving', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Grace');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Display name updated', 'success'));
  });

  it('shows an error toast when the save fails', async () => {
    const user = userEvent.setup();
    mockUpdateDisplayName.mockRejectedValue(new Error('network'));
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Grace');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Couldn't change display name. Try again.", 'error'));
  });
});

describe('ProfileSection — Save button enablement', () => {
  it('disables Save when the name is unchanged', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save when the input is empty', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save when the input is only whitespace', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables Save once the name changes to a non-empty value', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Grace Hopper');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
