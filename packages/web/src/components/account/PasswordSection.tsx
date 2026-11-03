import React, { useState } from 'react';
import { useAuthStore, PASSWORD_CHANGED_MESSAGE } from '@festie/shared/stores/authStore';
import { PASSWORD_RULES, passwordPolicyError } from '@festie/shared/utils';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { isPasswordIncorrect, mapErrorToUserMessage } from '@festie/shared/services/api';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useToast } from '../../lib/toastContext';
import { useIdentities } from '../../lib/useIdentities';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Lock } from 'lucide-react';

export default function PasswordSection() {
  const { toast } = useToast();
  const changePassword = useAuthStore((s) => s.changePassword);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const user = useAuthStore((s) => s.user);
  const { data: identities } = useIdentities();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const policyError =
    newPassword.length >= 8
      ? passwordPolicyError(newPassword, { username: user?.username, email: user?.email })
      : null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword.length < 8) {
      toast('New password must be at least 8 characters', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('Passwords do not match', 'warning');
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast(PASSWORD_CHANGED_MESSAGE, 'success');
    } catch (err) {
      if (isPasswordIncorrect(err)) setCurrentError(mapErrorToUserMessage(err, ACCOUNT_COPY.changePasswordFailed));
      else toast(mapErrorToUserMessage(err, ACCOUNT_COPY.changePasswordFailed), 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  // A provider-only account has no password to change; Sign-in methods offers Set a password.
  if (identities?.hasPassword === false) return null;

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <Lock className="w-4 h-4" aria-hidden="true" />
        Change Password
      </h3>

      <form onSubmit={handlePasswordChange} className="space-y-3">
        <Input
          label="Current password"
          type="password"
          isPassword
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            setCurrentError(null);
          }}
          placeholder="Current password"
          autoComplete="current-password"
          error={currentError ?? undefined}
        />
        <Input
          label="New password"
          type="password"
          isPassword
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          error={policyError ?? undefined}
          aria-describedby={newPassword.length > 0 && newPassword.length < 8 ? 'pw-rules pw-hint' : 'pw-rules'}
        />
        {/* Outside the Input so the rule line stays visible while a policy error shows. */}
        <p id="pw-rules" className="text-sm text-text-muted">
          {PASSWORD_RULES}
        </p>
        {newPassword.length > 0 && newPassword.length < 8 && (
          <p id="pw-hint" className="text-xs text-accent-coral">
            {8 - newPassword.length} more character{8 - newPassword.length === 1 ? '' : 's'} needed
          </p>
        )}
        <Input
          label="Confirm new password"
          type="password"
          isPassword
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          error={passwordsMismatch ? 'Passwords do not match' : undefined}
        />
        <Button
          type="submit"
          variant="primary"
          fullWidth
          isLoading={savingPassword}
          disabled={
            offlineMode ||
            !currentPassword ||
            !newPassword ||
            !confirmPassword ||
            newPassword.length < 8 ||
            policyError !== null ||
            newPassword !== confirmPassword
          }
          className="min-h-[44px]"
        >
          Update Password
        </Button>
      </form>
    </section>
  );
}
