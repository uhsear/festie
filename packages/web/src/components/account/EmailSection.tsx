import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import ChangeEmailModal from '../layout/ChangeEmailModal';

export default function EmailSection() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const changeEmail = useAuthStore((s) => s.changeEmail);
  const [resending, setResending] = useState(false);
  const [showChange, setShowChange] = useState(false);

  if (!user) return null;

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerification();
      toast(ACCOUNT_COPY.emailSent, 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, 'Could not resend verification email. Try again.'), 'error');
    } finally {
      setResending(false);
    }
  };

  const handleChange = async (email: string, password: string) => {
    const message = await changeEmail(email, password);
    toast(message || 'Check your new address for the verification link.', 'success');
    setShowChange(false);
    await useAuthStore.getState().checkSession();
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <Mail className="w-4 h-4" aria-hidden="true" />
        {ACCOUNT_COPY.emailLabel}
      </h3>
      {user.email ? (
        <p className="text-sm text-text-primary truncate">{user.email}</p>
      ) : (
        <p className="text-sm text-text-muted italic">{ACCOUNT_COPY.emailNotSet}</p>
      )}
      {user.pendingEmail ? <p className="text-xs text-text-muted">{ACCOUNT_COPY.emailPending(user.pendingEmail)}</p> : null}
      <div className="flex flex-wrap gap-2">
        {user.email && !user.emailVerified ? (
          <Button variant="outline" size="sm" isLoading={resending} onClick={handleResend} className="min-h-[44px]">
            {ACCOUNT_COPY.emailResend}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setShowChange(true)} className="min-h-[44px]">
          {user.email ? ACCOUNT_COPY.emailChange : ACCOUNT_COPY.emailAdd}
        </Button>
      </div>
      {showChange && (
        <ChangeEmailModal currentEmail={user.email} onClose={() => setShowChange(false)} onSubmit={handleChange} />
      )}
    </section>
  );
}
