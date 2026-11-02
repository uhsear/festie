import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  useAuthStore,
  ACCOUNT_DELETION_EXPLAINER,
  accountDeletionNotice,
} from '@festie/shared/stores/authStore';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DangerZone() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);

  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (showDeleteConfirm) deleteFormRef.current?.querySelector('input')?.focus();
  }, [showDeleteConfirm]);

  const handleDelete = async () => {
    if (!deletePassword) return;

    setDeleting(true);
    try {
      const { deletionDate } = await deleteAccount(deletePassword);
      toast(accountDeletionNotice(deletionDate), 'info');
      navigate({ to: '/login' });
    } catch {
      toast("Couldn't delete account. Try again.", 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Delete account section */}
      <section
        className={cn(
          'p-4 rounded-lg border space-y-3',
          'bg-accent-coral/5 border-accent-coral/30',
        )}
      >
        <h3 className="text-sm font-semibold text-accent-coral flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          Delete Account
        </h3>

        <p className="text-sm text-text-muted">
          {ACCOUNT_DELETION_EXPLAINER}
        </p>

        {!showDeleteConfirm ? (
          <Button
            variant="danger"
            fullWidth
            onClick={() => setShowDeleteConfirm(true)}
            className="min-h-[44px]"
          >
            Delete My Account
          </Button>
        ) : (
          <form
            ref={deleteFormRef}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (deletePassword && !deleting) handleDelete();
            }}
          >
            <Input
              label="Enter your password to confirm"
              type="password"
              isPassword
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletePassword('');
                }}
                className="flex-1 min-h-[44px]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                isLoading={deleting}
                disabled={!deletePassword}
                className="flex-1 min-h-[44px]"
              >
                Confirm Delete
              </Button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
