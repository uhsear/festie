import { passwordStrength } from '@festie/shared/utils';

// Index is score - 1: weak to strong, matching the mobile meter.
const SEGMENT_COLORS = ['bg-accent-coral', 'bg-accent-amber', 'bg-accent-aqua', 'bg-accent-green'];
const LABEL_COLORS = ['text-accent-coral', 'text-accent-amber', 'text-accent-aqua', 'text-accent-green'];

/** Strength guidance while typing. The shared password policy stays authoritative. */
export default function PasswordStrengthMeter({
  password,
  username,
  email,
}: {
  password: string;
  username?: string | null;
  email?: string | null;
}) {
  const { score, label } = passwordStrength(password, { username, email });
  if (score === 0) return null;
  return (
    <div className="mt-2 flex items-center gap-2" role="status" aria-label={`Password strength: ${label}`}>
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            data-testid="strength-segment"
            data-filled={i < score}
            className={`h-1.5 flex-1 rounded-full ${i < score ? SEGMENT_COLORS[score - 1] : 'bg-border'}`}
          />
        ))}
      </div>
      <span className={`text-xs font-medium ${LABEL_COLORS[score - 1]}`}>{label}</span>
    </div>
  );
}
