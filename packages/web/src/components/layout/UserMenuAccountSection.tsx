import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { COPY } from '@festie/shared/constants';
import Button from '../ui/Button';

interface UserMenuAccountSectionProps {
  user: { isAdmin?: boolean };
  onClose: () => void;
  onLogout: () => void;
}

export default function UserMenuAccountSection({ user, onClose, onLogout }: UserMenuAccountSectionProps) {
  const navigate = useNavigate();

  return (
    <section
      className="pt-3 mt-3 border-t border-border first-of-type:pt-0 first-of-type:mt-0 first-of-type:border-t-0"
      data-testid="account-section"
    >
      <div className="flex flex-col gap-[var(--space-3)]">
        {/* Desktop hides the bottom nav, so this is the way to /account at lg+. */}
        <Button
          variant="outline"
          size="sm"
          type="button"
          data-testid="user-menu-account-link"
          onClick={() => {
            onClose();
            navigate({ to: '/account' });
          }}
        >
          Account settings
        </Button>
        {user.isAdmin && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => {
              onClose();
              navigate({ to: '/admin' });
            }}
          >
            Admin
          </Button>
        )}
        <Button variant="ghost" size="sm" type="button" onClick={onLogout}>
          {COPY.auth.signOut}
        </Button>
      </div>
    </section>
  );
}
