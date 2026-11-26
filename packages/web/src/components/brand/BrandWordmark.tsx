import { AUTH_COPY } from '@festie/shared/constants';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { cn } from '../../lib/utils';

interface BrandWordmarkProps {
  /** Mark size in px, drawn beside the text (20 to 24). Omit when the screen shows a large mark elsewhere. */
  markSize?: 20 | 22 | 24;
  /** Element for the text. Auth screens use `h1`. */
  as?: 'span' | 'h1';
  /** Size and spacing. Weight and colour are fixed here. */
  className?: string;
}

/**
 * The FESTIE wordmark (OD-2): Clash Display 700 caps in house-light text, one weight at every
 * breakpoint. Tracking is the only responsive change. The mark keeps its own brand colours.
 */
export default function BrandWordmark({ markSize, as: Tag = 'span', className }: BrandWordmarkProps) {
  const theme = useUIStore((s) => s.theme);
  return (
    <span className="inline-flex items-center gap-2">
      {markSize && (
        <img
          src={theme === 'daylight' ? '/favicon-daylight.svg' : '/favicon.svg'}
          width={markSize}
          height={markSize}
          alt=""
          className="shrink-0"
        />
      )}
      <Tag
        data-testid="brand-wordmark"
        className={cn(
          'font-display font-bold uppercase text-text-primary whitespace-nowrap',
          'tracking-[0.12em] max-[480px]:tracking-[0.08em]',
          className,
        )}
      >
        {AUTH_COPY.wordmark}
      </Tag>
    </span>
  );
}
