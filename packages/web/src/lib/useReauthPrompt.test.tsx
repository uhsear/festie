import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReauthBody } from '@festie/shared/services/admin';
import { useReauthPrompt } from './useReauthPrompt';

vi.mock('../components/auth/ProviderButtons', () => ({
  default: ({ mode, only, onCredential }: { mode: string; only?: string[]; onCredential: (p: string, b: unknown) => void }) => (
    <button
      data-only={only?.join(',')}
      onClick={() => onCredential('google', { idToken: 'tok'.repeat(10), nonce: 'n'.repeat(20), redirectUri: 'ignored' })}>
      {`provider-${mode}`}
    </button>
  ),
}));

let ask: () => Promise<string | ReauthBody | null>;

function Harness({ hasPassword = true }: { hasPassword?: boolean }) {
  const { askPassword, reauthDialog } = useReauthPrompt({ hasPassword, linked: ['google'] });
  ask = askPassword;
  return <>{reauthDialog}</>;
}

describe('useReauthPrompt', () => {
  it('resolves with the typed password, untrimmed', async () => {
    render(<Harness />);
    let result: Promise<string | ReauthBody | null>;
    act(() => {
      result = ask();
    });
    await userEvent.type(await screen.findByPlaceholderText('Password'), ' hunter2 ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(result!).resolves.toBe(' hunter2 ');
  });

  it('resolves null on cancel', async () => {
    render(<Harness />);
    let result: Promise<string | ReauthBody | null>;
    act(() => {
      result = ask();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(result!).resolves.toBeNull();
  });

  it('asks a provider-only account to sign in with its provider and resolves with the token body', async () => {
    render(<Harness hasPassword={false} />);
    let result: Promise<string | ReauthBody | null>;
    act(() => {
      result = ask();
    });
    expect(await screen.findByText(/Sign in with Google again/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
    // Only linked providers are offered; another provider would get IDENTITY_NOT_LINKED.
    expect(screen.getByRole('button', { name: 'provider-reauth' })).toHaveAttribute('data-only', 'google');
    await userEvent.click(screen.getByRole('button', { name: 'provider-reauth' }));
    await expect(result!).resolves.toEqual({ provider: 'google', idToken: 'tok'.repeat(10), nonce: 'n'.repeat(20) });
  });

  it('resolves null when a provider-only user cancels', async () => {
    render(<Harness hasPassword={false} />);
    let result: Promise<string | ReauthBody | null>;
    act(() => {
      result = ask();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await expect(result!).resolves.toBeNull();
  });
});
