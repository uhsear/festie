import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AVATAR_COPY } from '@festie/shared/constants';

const mockUploadAvatar = vi.fn();
const mockRemoveAvatar = vi.fn();
let authState: Record<string, unknown>;

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(authState),
}));

vi.mock('@festie/shared/services/api', () => ({
  mapErrorToUserMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

import AccountIdentityCard from './AccountIdentityCard';

function setAuth(userOverrides: Record<string, unknown> = {}) {
  authState = {
    user: { id: 'u1', name: 'Ada', username: 'ada', email: 'ada@x.us', emailVerified: true, ...userOverrides },
    uploadAvatar: mockUploadAvatar,
    removeAvatar: mockRemoveAvatar,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadAvatar.mockResolvedValue(undefined);
  mockRemoveAvatar.mockResolvedValue(undefined);
  setAuth();
});

describe('AccountIdentityCard', () => {
  it('shows the photo and Remove photo when avatarUrl is set', () => {
    setAuth({ avatarUrl: 'https://x/y.png' });
    const { container } = render(<AccountIdentityCard />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x/y.png');
    expect(screen.getByRole('button', { name: AVATAR_COPY.remove })).toBeInTheDocument();
  });

  it('hides Remove photo without a photo', () => {
    render(<AccountIdentityCard />);
    expect(screen.queryByRole('button', { name: AVATAR_COPY.remove })).not.toBeInTheDocument();
    expect(screen.getByText(AVATAR_COPY.rules)).toBeInTheDocument();
  });

  it('toasts the upload error message', async () => {
    mockUploadAvatar.mockRejectedValue(new Error(AVATAR_COPY.tooBig));
    render(<AccountIdentityCard />);
    const file = new File(['x'], 'big.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('avatar-file-input'), { target: { files: [file] } });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(AVATAR_COPY.tooBig, 'error'));
  });

  it('shows progress and disables the button while uploading', async () => {
    let resolve!: () => void;
    mockUploadAvatar.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    render(<AccountIdentityCard />);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('avatar-file-input'), { target: { files: [file] } });
    expect(await screen.findByText(AVATAR_COPY.uploading)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: AVATAR_COPY.add })).toBeDisabled();
    resolve();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(AVATAR_COPY.updated, 'success'));
  });
});
