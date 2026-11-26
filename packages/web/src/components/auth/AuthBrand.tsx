import { Link } from '@tanstack/react-router';
import { AUTH_COPY } from '@festie/shared/constants';
import { useUIStore } from '@festie/shared/stores/uiStore';
import BrandWordmark from '../brand/BrandWordmark';

/**
 * One brand block for login, register, forgot-password and reset-password:
 * the mark (a link home), left-aligned with the form column,, the FESTIE wordmark and a one-line subtitle.
 */
export default function AuthBrand({ subtitle }: { subtitle?: string }) {
  const theme = useUIStore((s) => s.theme);
  return (
    <div className="flex w-full max-w-[360px] flex-col items-start text-left mb-8 relative z-[1]">
      <Link
        to="/"
        aria-label="Festie home"
        className="mb-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
      >
        <img src={theme === 'daylight' ? '/favicon-daylight.svg' : '/favicon.svg'} width={64} height={64} alt="" />
      </Link>
      <BrandWordmark as="h1" className="text-[clamp(22px,5vw,36px)] mb-3" />
      <p className="text-text-secondary text-[length:var(--font-size-16)] tracking-[0.5px]">
        {subtitle ?? AUTH_COPY.tagline}
      </p>
    </div>
  );
}
