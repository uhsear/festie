import { useLocation, useNavigate } from '@tanstack/react-router';
import { Star, Users, Sparkles, type LucideIcon } from 'lucide-react';
import { GUEST_PROMPT_COPY } from '@festie/shared/constants';
import Button from '../ui/Button';
import { cn } from '@/lib/utils';

interface GuestTeaserProps {
  mode: 'picks' | 'crew' | 'wrap';
  className?: string;
}

const ICONS: Record<GuestTeaserProps['mode'], LucideIcon> = {
  picks: Star,
  crew: Users,
  wrap: Sparkles,
};

export default function GuestTeaser({ mode, className }: GuestTeaserProps) {
  const navigate = useNavigate();
  const { href } = useLocation();
  const { title, message } = GUEST_PROMPT_COPY.teasers[mode];
  const Icon = ICONS[mode];

  return (
    <section
      aria-labelledby={`guest-teaser-${mode}-heading`}
      className={cn('flex flex-col items-center justify-center py-8 px-4', className)}
    >
      <Icon aria-hidden="true" className="w-14 h-14 text-accent-aqua mb-6" />
      <h2
        id={`guest-teaser-${mode}-heading`}
        className="text-2xl font-display font-bold text-text-primary mb-3 text-center"
      >
        {title}
      </h2>
      <p className="text-center text-text-secondary mb-8 max-w-sm text-sm leading-relaxed">{message}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={() => navigate({ to: '/register', search: { next: href } })}>
          {GUEST_PROMPT_COPY.createAccount}
        </Button>
        <Button variant="secondary" onClick={() => navigate({ to: '/login', search: { next: href } })}>
          {GUEST_PROMPT_COPY.signIn}
        </Button>
      </div>
    </section>
  );
}
