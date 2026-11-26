import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ACCOUNT_COPY, COPY, SUPPORT_URL_PAYPAL } from '@festie/shared/constants';
import Button from '../ui/Button';

interface UserMenuAccountSectionProps {
  user: { isAdmin?: boolean; organizations?: ReadonlyArray<unknown> };
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
          variant="secondary"
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
        {!!user.organizations?.length && (
          <Button
            variant="secondary"
            size="sm"
            type="button"
            data-testid="user-menu-manage-link"
            onClick={() => {
              onClose();
              navigate({ to: '/manage' });
            }}
          >
            Manage your festivals
          </Button>
        )}
        {user.isAdmin && (
          <Button
            variant="secondary"
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
        <a
          href={SUPPORT_URL_PAYPAL}
          target="_blank"
          rel="noopener noreferrer"
          className="type-caption text-center text-text-muted no-underline hover:text-accent-aqua focus-visible:outline-2 focus-visible:outline-accent-aqua"
        >
          {ACCOUNT_COPY.supportFestie}
        </a>
      </div>
    </section>
  );
}
