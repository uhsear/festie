import React from 'react';
import { Loader } from 'lucide-react';
import type { ButtonVariant as SharedButtonVariant } from '@festie/shared/tokens';
import { cn } from '../../lib/utils';

// `delete` is a web-only icon button.
type ButtonVariant = SharedButtonVariant | 'delete';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  disabled = false,
  icon,
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[color,background-color,border-color,box-shadow,scale,outline-color] duration-200 ease-out cursor-pointer press-scale active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed aria-busy:opacity-50 aria-busy:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2';

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      'bg-accent-aqua text-[var(--text-on-light-accent)] hover:bg-[var(--color-accent-aqua-hover)] focus-visible:outline-accent-aqua',
    // DANGER/SOS only. Filled with the deepened coral so WHITE label text clears
    // WCAG AA (white on brand #ff3366 fails). Primary actions use aqua, not coral.
    danger:
      'bg-accent-coral-strong text-text-on-accent hover:bg-[var(--color-accent-coral-strong-hover)] focus-visible:outline-accent-coral',
    ghost:
      'bg-transparent text-text-secondary border border-transparent hover:text-text-primary hover:bg-bg-card focus-visible:outline-text-primary',
    // R3 outline-secondary: the canonical demoted CTA — transparent fill, 1px
    // aqua/70 border, secondary text; hover lifts the border to full aqua + text to primary.
    // Single solid aqua per screen lives on `primary`; this is everything else.
    secondary:
      'bg-transparent text-text-secondary border border-accent-aqua/70 hover:border-accent-aqua hover:text-text-primary focus-visible:outline-accent-aqua',
    utility: 'bg-[var(--color-overlay-2)] text-text-secondary border border-border-light text-[length:var(--font-size-12)] font-semibold tracking-wide hover:border-accent-aqua hover:text-text-primary hover:bg-[var(--color-overlay-4)] focus-visible:outline-accent-aqua [&_svg]:size-4',
    delete:
      'w-11 h-11 min-w-11 min-h-11 rounded-full bg-transparent text-accent-coral border border-transparent hover:bg-accent-coral/10 hover:border-accent-coral focus-visible:outline-accent-coral',
  };

  const sizeStyles: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm min-h-11',
    md: 'px-4 py-2 text-base min-h-11',
    lg: 'px-5 py-2.5 text-lg min-h-11',
  };

  // utility and delete variants have their own sizing — skip the size map
  const appliedSize =
    variant === 'utility'
      ? 'px-2.5 py-1.5 min-h-11 min-w-11'
      : variant === 'delete'
        ? '' // sizing baked into variant
        : sizeStyles[size];

  // A busy button stays focusable (aria-disabled, not native disabled) so keyboard
  // focus is not dropped mid-request; activation is blocked here instead.
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isLoading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...props}
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={isLoading || undefined}
      aria-busy={isLoading || undefined}
      className={cn(baseStyles, variantStyles[variant], appliedSize, fullWidth && 'w-full', className)}
    >
      {isLoading && <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {!isLoading && icon}
      {children}
    </button>
  );
}
