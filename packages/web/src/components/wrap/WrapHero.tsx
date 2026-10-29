import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';

interface WrapHeroProps {
  /** The one number the recap leads with. */
  value: number;
  label: string;
  /** One quiet line of supporting facts under the number. */
  detail?: string;
}

/** Editorial hero stat: one big count-up number, one label, one supporting line. */
export default function WrapHero({ value, label, detail }: WrapHeroProps) {
  const animated = useAnimatedNumber(value, { duration: 800, decimals: 0, startFrom: 0 });
  return (
    <section aria-label={`${value} ${label}`} className="text-center py-4">
      <div
        className="font-display font-bold text-accent-aqua text-5xl leading-none tracking-[var(--letter-spacing-display)]"
        aria-hidden="true"
      >
        {animated}
      </div>
      <div className="mt-2 text-lg font-display font-bold text-text-primary">{label}</div>
      {detail && <p className="mt-1 text-sm text-text-secondary">{detail}</p>}
    </section>
  );
}
