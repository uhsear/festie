import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';

interface WrapHeroProps {
  /** The one number the recap leads with. */
  value: number;
  label: string;
  /** One quiet line of supporting facts under the number. */
  detail?: string;
}

/** Single-line recap: a count-up number, its label, and the supporting facts. */
export default function WrapHero({ value, label, detail }: WrapHeroProps) {
  const animated = useAnimatedNumber(value, { duration: 800, decimals: 0, startFrom: 0 });
  return (
    <p aria-label={`${value} ${label}`} className="text-center text-sm text-text-secondary">
      <span className="font-display font-bold text-accent-aqua" aria-hidden="true">
        {animated}
      </span>{' '}
      <span aria-hidden="true">
        {label}
        {detail && ` · ${detail}`}
      </span>
    </p>
  );
}
