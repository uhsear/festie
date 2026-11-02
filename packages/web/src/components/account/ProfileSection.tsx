import React, { useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { AtSign, User } from 'lucide-react';

interface ProfileSectionProps {
  user: {
    name?: string;
    username?: string;
  };
}

export default function ProfileSection({ user }: ProfileSectionProps) {
  const { toast } = useToast();
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName);

  const [displayName, setDisplayName] = useState(user.name || '');
  const [savingDisplayName, setSavingDisplayName] = useState(false);

  const handleDisplayNameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = displayName.trim();
    if (!next) return;

    setSavingDisplayName(true);
    try {
      await updateDisplayName(next);
      toast('Display name updated', 'success');
    } catch {
      toast("Couldn't change display name. Try again.", 'error');
    } finally {
      setSavingDisplayName(false);
    }
  };

  return (
    <>
      {/* Display name section */}
      <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
          <User className="w-4 h-4" aria-hidden="true" />
          Display name
        </h3>

        <form onSubmit={handleDisplayNameChange} className="flex gap-2">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How your name appears to your crew"
            className="flex-1"
            autoComplete="name"
            maxLength={50}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={savingDisplayName}
            disabled={!displayName.trim() || displayName.trim() === (user.name ?? '')}
            className="min-h-[44px] min-w-[44px]"
          >
            Save
          </Button>
        </form>

        {/* Username is the permanent @handle — shown read-only. */}
        {user.username ? (
          <div className="flex items-center gap-2 pt-1 text-sm text-text-secondary">
            <AtSign className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              <span className="text-text-primary font-medium">@{user.username}</span>
              <span className="text-text-muted"> · username can’t be changed</span>
            </span>
          </div>
        ) : null}
      </section>
    </>
  );
}
