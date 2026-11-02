import { useAuthStore } from '@festie/shared/stores/authStore';
import { ACCOUNT_COPY, SUPPORT_EMAIL, SUPPORT_URL_PAYPAL } from '@festie/shared/constants';
import { buildSupportMailto } from '@festie/shared/utils';
import ReplayIntroRow from './ReplayIntroRow';
import InstallAppRow from './InstallAppRow';

const rowClass =
  'flex min-h-11 items-center gap-3 rounded-lg border border-border bg-bg-card p-3 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

function LinkRow({ href, title, hint, external }: { href: string; title: string; hint?: string; external?: boolean }) {
  return (
    <a
      href={href}
      className={rowClass}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-primary">{title}</span>
        {hint ? <span className="block text-xs text-text-muted">{hint}</span> : null}
      </span>
    </a>
  );
}

/** Help and legal: intro replay, support, terms, privacy, Support Festie, install and the build version. */
export default function HelpSection() {
  const username = useAuthStore((s) => s.user?.username);
  const version = import.meta.env.VITE_APP_VERSION || 'dev';

  return (
    <div className="space-y-2">
      <ReplayIntroRow />
      <LinkRow
        href={buildSupportMailto({ platform: 'web', version, device: navigator.userAgent, username })}
        title={ACCOUNT_COPY.contactSupport}
        hint={SUPPORT_EMAIL}
      />
      <LinkRow href="/terms" title={ACCOUNT_COPY.terms} external />
      <LinkRow href="/privacy.html" title={ACCOUNT_COPY.privacy} external />
      <LinkRow href={SUPPORT_URL_PAYPAL} title={ACCOUNT_COPY.supportFestie} hint={ACCOUNT_COPY.supportFestieHint} external />
      <LinkRow href="/third-party-notices.txt" title="Third-party notices" external />
      <InstallAppRow />
      <p className="px-1 text-xs text-text-muted">{ACCOUNT_COPY.versionLine('web', version)}</p>
    </div>
  );
}
