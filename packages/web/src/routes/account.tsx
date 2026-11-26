import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Building2, Gauge, LogOut, Sparkles } from 'lucide-react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { ACCOUNT_COPY, ACCOUNT_SECTIONS, COPY } from '@festie/shared/constants';
import type { AccountSectionId } from '@festie/shared/constants';
import AccountIdentityCard from '../components/account/AccountIdentityCard';
import { useUIStore } from '@festie/shared/stores/uiStore';
import ProfileSection from '../components/account/ProfileSection';
import EmailSection from '../components/account/EmailSection';
import PaymentHandlesSection from '../components/account/PaymentHandlesSection';
import PasswordSection from '../components/account/PasswordSection';
import SignInMethodsSection from '../components/account/SignInMethodsSection';
import NotificationSection from '../components/account/NotificationSection';
import PublicScheduleSection from '../components/account/PublicScheduleSection';
import PrivacySection from '../components/account/PrivacySection';
import DevicesSection from '../components/account/DevicesSection';
import HelpSection from '../components/account/HelpSection';
import ThemeSection from '../components/account/ThemeSection';
import HapticsSection from '../components/account/HapticsSection';
import HistorySection from '../components/account/HistorySection';
import DataExportSection from '../components/account/DataExportSection';
import DangerZone from '../components/account/DangerZone';
import LowPowerToggle from '../components/features/LowPowerToggle';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

export default function AccountPage() {
  return (
    <RenderErrorBoundary name="account">
      <AccountPageInner />
    </RenderErrorBoundary>
  );
}

/**
 * Account screen — mirrors packages/mobile/app/(tabs)/account.tsx.
 *
 * Renders ACCOUNT_SECTIONS (@festie/shared) in order, the same list mobile
 * maps, so the two pages cannot drift. Each section renders as a small
 * uppercase `label`-role header above its body; an empty label renders no
 * header, and `adminOnly` sections show for admins only. The section
 * sub-components own their own Card chrome. Auth gate is unchanged.
 */
function AccountPageInner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const logout = useAuthStore((s) => s.logout);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const offlineMode = useUIStore((s) => s.offlineMode);

  useEffect(() => {
    if (!user) navigate({ to: '/login' }).catch(() => {});
  }, [user, navigate]);
  // The public /delete-account page links to /account#danger. useScrollReset leaves a hash target alone, but async
  // sections above the zone still shift the layout after mount, so re-pin every 100 ms for 2 s. Move focus to the zone
  // once, then stop pinning as soon as the user scrolls or focus moves (assistive tech raises focusin, not wheel/keys).
  const hasUser = !!user;
  useEffect(() => {
    if (!hasUser || window.location.hash !== '#danger') return;
    const pin = () => document.getElementById('danger')?.scrollIntoView();
    const stopEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'focusin'];
    const stop = () => {
      window.clearInterval(timer);
      stopEvents.forEach((e) => window.removeEventListener(e, stop));
    };
    pin();
    document.getElementById('danger')?.focus({ preventScroll: true });
    const timer = window.setInterval(pin, 100);
    const timeout = window.setTimeout(stop, 2000);
    stopEvents.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    return () => {
      window.clearTimeout(timeout);
      stop();
    };
  }, [hasUser]);
  if (!user) return null;

  const handleSignOut = async () => {
    setConfirmSignOut(false);
    try {
      await logout();
    } catch (e) {
      console.error('Logout failed:', e);
    }
    await navigate({ to: '/login' });
  };

  const body: Record<AccountSectionId, React.ReactNode> = {
    account: (
      <>
        <div id="profile" tabIndex={-1} className="focus:outline-none">
          <ProfileSection user={user} />
          <EmailSection />
          <PaymentHandlesSection />
        </div>
        <div id="sign-in" tabIndex={-1} className="focus:outline-none">
          <PasswordSection />
          <SignInMethodsSection />
          <DevicesSection />
        </div>
      </>
    ),
    notifications: <NotificationSection />,
    privacy: (
      <>
        <PrivacySection />
        <PublicScheduleSection />
      </>
    ),
    offline: (
      <>
        <LowPowerToggle />
        <DataExportSection />
      </>
    ),
    appearance: (
      <>
        <ThemeSection />
        <HapticsSection />
        <p className="px-1 text-xs text-text-muted">{ACCOUNT_COPY.motionNote}</p>
      </>
    ),
    festivals: (
      <>
        {!!user.organizations?.length && (
          <Link
            to="/manage"
            className="flex items-center gap-3 border-b border-border-light py-3 min-h-11 hover:bg-surface-hover"
          >
            <Building2 className="h-5 w-5 text-accent-aqua" aria-hidden="true" />
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-text-primary">{ACCOUNT_COPY.manageTitle}</span>
              <span className="text-xs text-text-secondary">{ACCOUNT_COPY.manageHint}</span>
            </span>
          </Link>
        )}
        <Link
          to="/wrap"
          className="flex items-center gap-3 border-b border-border-light py-3 min-h-11 hover:bg-surface-hover"
        >
          <Sparkles className="h-5 w-5 text-accent-aqua" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">{COPY.wrap.name}</span>
            <span className="text-xs text-text-secondary">{COPY.wrap.hint}</span>
          </span>
        </Link>
        <HistorySection />
      </>
    ),
    help: <HelpSection />,
    admin: (
      <Link
        to="/admin"
        className="flex items-center gap-3 border-b border-border-light py-3 min-h-11 hover:bg-surface-hover"
      >
        <Gauge className="w-5 h-5 shrink-0 text-accent-aqua" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary">{ACCOUNT_COPY.adminTitle}</span>
          <span className="block text-xs text-text-muted">{ACCOUNT_COPY.adminHint}</span>
        </span>
      </Link>
    ),
    signOut: (
      <>
        <button
          type="button"
          onClick={() => setConfirmSignOut(true)}
          className="flex w-full items-center gap-3 border-b border-border-light py-3 min-h-11 text-sm font-semibold text-text-danger hover:bg-surface-hover"
        >
          <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
          {COPY.auth.signOut}
        </button>
        <ConfirmDialog
          open={confirmSignOut}
          onOpenChange={setConfirmSignOut}
          title={COPY.auth.signOut}
          description={COPY.auth.signOutConfirm}
          confirmLabel={COPY.auth.signOut}
          destructive
          onConfirm={handleSignOut}
        />
      </>
    ),
    danger: <DangerZone />,
  };

  return (
    <div className="bg-bg-primary">
      <div className="max-w-[600px] lg:max-w-4xl mx-auto pb-6 space-y-4">
        <div>
          <h1 className="text-xl font-display font-bold text-text-primary">{ACCOUNT_COPY.title}</h1>
          <p className="text-sm text-text-secondary">{ACCOUNT_COPY.subtitle}</p>
        </div>

        <AccountIdentityCard />

        {offlineMode ? (
          <p role="status" className="rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-sm text-accent-amber">
            You're offline. Settings need a connection.
          </p>
        ) : null}

        <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
          <SectionRail />
          <div className="space-y-4 min-w-0">
            {ACCOUNT_SECTIONS.filter((s) => !('adminOnly' in s) || isAdmin).map((s) => (
              <Section key={s.id} id={s.id} label={s.label}>
                {body[s.id]}
              </Section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Labeled section wrapper: a small uppercase `label`-role header above the
 * section body. Mirrors the mobile `sectionLabel` type style. An empty label
 * renders the body with no header.
 */
function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div id={id} tabIndex={-1} className="space-y-3 focus:outline-none">
      {label ? (
        <h2 className="px-1 text-xs font-semibold text-text-secondary uppercase tracking-[.8px]">{label}</h2>
      ) : null}
      {children}
    </div>
  );
}

// Desktop only: phones read the page as one column. Each entry jumps to a section id on the page.
const RAIL_SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'sign-in', label: 'Sign-in' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'offline', label: 'Data' },
  { id: 'danger', label: 'Danger' },
] as const;

function SectionRail() {
  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    el?.scrollIntoView();
    el?.focus({ preventScroll: true });
  };
  return (
    <nav aria-label="Account sections" className="hidden lg:block sticky top-4">
      <ul className="m-0 list-none space-y-1 p-0">
        {RAIL_SECTIONS.map((r) => (
          <li key={r.id}>
            <a
              href={`#${r.id}`}
              onClick={(e) => jump(e, r.id)}
              className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-surface-hover ${
                r.id === 'danger' ? 'text-text-danger' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {r.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
