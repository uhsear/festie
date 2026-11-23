import React, { useState } from 'react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import Dialog from '../ui/Dialog';
import Button from '../ui/Button';
import Input from '../ui/Input';

interface ChangeEmailModalProps {
  /** Address currently on file. Absent means the account has no email yet, which switches the copy from "change" to "add". */
  currentEmail?: string;
  /** false for a provider-only account: no password field, and onSubmit gets no password. */
  needsPassword?: boolean;
  onClose: () => void;
  onSubmit: (email: string, password?: string) => Promise<void>;
}

export default function ChangeEmailModal({ currentEmail, needsPassword = true, onClose, onSubmit }: ChangeEmailModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit(email.trim(), needsPassword ? password : undefined);
    } catch (err) {
      setError(mapErrorToUserMessage(err, "Couldn't request the email change."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={currentEmail ? 'Change email' : 'Add email'}>
      <section className="pt-3 mt-3 border-t border-border first-of-type:pt-0 first-of-type:mt-0 first-of-type:border-t-0">
        <p className="text-[length:var(--font-size-14)] text-text-secondary mb-1.5">
          We send a verification link to the new address, and tell{' '}
          {currentEmail ? 'your current address' : 'the address on file'} that a change was requested. Your login email
          stays the same until you open that link.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="py-2.5">
            <Input
              id="ce-email"
              label="New email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              required
            />
          </div>
          {needsPassword && (
            <div className="py-2.5">
              <Input
                id="ce-password"
                label="Current password"
                isPassword
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="text-[length:var(--font-size-14)] text-[var(--color-text-danger)]"
            >
              {error}
            </div>
          )}
          <div className="flex flex-col gap-[var(--space-3)]">
            <Button variant="primary" size="sm" type="submit" disabled={busy || !email || (needsPassword && !password)}>
              {busy ? 'Sending…' : 'Send Verification Link'}
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </Dialog>
  );
}
