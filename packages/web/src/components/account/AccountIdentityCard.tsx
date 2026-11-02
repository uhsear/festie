import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { ACCOUNT_COPY, AVATAR_COPY } from '@festie/shared/constants';
import { AVATAR_ACCEPT, identityLabel } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import Avatar from '../ui/Avatar';
import ConfirmDialog from '../ui/ConfirmDialog';

const CHIP =
  'inline-flex items-center text-xs font-semibold px-[7px] py-0.5 rounded-md tracking-[.3px] whitespace-nowrap';

/** Identity header for /account: the one avatar on the page, name, @handle, email and chips. */
export default function AccountIdentityCard() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const uploadAvatar = useAuthStore((s) => s.uploadAvatar);
  const removeAvatar = useAuthStore((s) => s.removeAvatar);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!user) return null;

  const hasPhoto = Boolean(user.avatarUrl);
  const displayName = user.name ?? user.username ?? 'Account';

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('upload');
    try {
      await uploadAvatar(file);
      toast(AVATAR_COPY.updated, 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, AVATAR_COPY.uploadFailed), 'error');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    setConfirmRemove(false);
    setBusy('remove');
    try {
      await removeAvatar();
      toast(AVATAR_COPY.removed, 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, AVATAR_COPY.removeFailed), 'error');
    } finally {
      setBusy(null);
    }
  };

  const status = busy === 'upload' ? AVATAR_COPY.uploading : busy === 'remove' ? AVATAR_COPY.removing : AVATAR_COPY.rules;

  return (
    <section className="flex items-center gap-4 p-4 rounded-xl bg-bg-card border border-border">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy !== null}
        aria-label={hasPhoto ? AVATAR_COPY.change : AVATAR_COPY.add}
        className="relative shrink-0 rounded-full min-h-11 min-w-11 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
      >
        <Avatar name={identityLabel(user)} image={user.avatarUrl ?? undefined} size="lg" />
        <span
          className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-accent-aqua text-text-on-accent"
          aria-hidden="true"
        >
          <Camera className="w-3.5 h-3.5" />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        tabIndex={-1}
        data-testid="avatar-file-input"
        onChange={handleFile}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-lg font-semibold text-text-primary truncate">{displayName}</p>
        {user.username ? <p className="text-sm text-accent-aqua truncate">@{user.username}</p> : null}
        {user.email ? <p className="text-xs text-text-secondary truncate">{user.email}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {user.email ? (
            user.emailVerified ? (
              <span className={`${CHIP} bg-[var(--color-status-verified-bg)] text-[var(--color-status-verified)]`}>
                {ACCOUNT_COPY.verified}
              </span>
            ) : (
              <span className={`${CHIP} bg-[var(--color-status-unverified-bg)] text-[var(--color-status-unverified)]`}>
                {ACCOUNT_COPY.unverified}
              </span>
            )
          ) : null}
          {user.isAdmin ? (
            <span className={`${CHIP} bg-[var(--color-aqua-a12)] text-accent-aqua`}>Admin</span>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-text-muted" aria-live="polite">
          <span>{status}</span>
          {hasPhoto ? (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={busy !== null}
              className="text-accent-aqua hover:underline disabled:opacity-60 min-h-6"
            >
              {AVATAR_COPY.remove}
            </button>
          ) : null}
        </p>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={AVATAR_COPY.removeConfirmTitle}
        description={AVATAR_COPY.removeConfirmBody}
        confirmLabel={AVATAR_COPY.remove}
        destructive
        onConfirm={handleRemove}
      />
    </section>
  );
}
