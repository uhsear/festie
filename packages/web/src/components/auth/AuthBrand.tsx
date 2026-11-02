import { Link } from '@tanstack/react-router';
import { AUTH_COPY } from '@festie/shared/constants';
import { cn } from '../../lib/utils';

/**
 * One brand block for login, register, forgot-password and reset-password:
 * the mark (a link home), the FESTIE wordmark and a one-line subtitle.
 */
export default function AuthBrand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex flex-col items-center text-center mb-8 relative z-[1]">
      <Link
        to="/"
        aria-label="Festie home"
        className="mb-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
      >
        <img src="/favicon.svg" width={64} height={64} alt="" />
      </Link>
      <h1
        className={cn(
          'font-display text-[clamp(22px,5vw,36px)] font-bold tracking-[6px] uppercase',
          'text-accent-coral mb-3',
        )}
      >
        {AUTH_COPY.wordmark}
      </h1>
      <p className="text-text-secondary text-[length:var(--font-size-16)] tracking-[0.5px]">
        {subtitle ?? AUTH_COPY.tagline}
      </p>
    </div>
  );
}
