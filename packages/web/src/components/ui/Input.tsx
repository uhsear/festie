import React, { useState, useId } from 'react';
import { Eye, EyeOff, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { inputBase } from '../../lib/styles';

// Both eye icons stay mounted and cross-fade (scale/opacity/blur) so the reveal toggle animates.
const EYE_ICON =
  'absolute inset-0 w-5 h-5 transition-[opacity,filter,scale] duration-(--duration-slow) ease-(--ease-standard) motion-reduce:transition-none';
const EYE_HIDDEN = 'opacity-0 scale-[0.25] blur-[4px] motion-reduce:scale-100 motion-reduce:blur-none';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  isPassword?: boolean;
  variant?: 'default' | 'search';
}

export default function Input({
  label,
  error,
  helperText,
  isPassword = false,
  variant = 'default',
  className,
  type,
  id,
  'aria-describedby': ariaDescribedBy,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type || 'text';
  const generatedId = useId();
  const inputId = id || generatedId;
  const labelOnly = label && !props['aria-label'];
  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = helperText && !error ? `${inputId}-helper` : undefined;
  const describedBy = [errorId, helperId, ariaDescribedBy].filter(Boolean).join(' ') || undefined;

  const isSearch = variant === 'search';

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-text-primary mb-2">
          {label}
        </label>
      )}

      <div className="relative">
        {isSearch && (
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
            aria-hidden="true"
          />
        )}

        <input
          id={inputId}
          type={inputType}
          aria-label={props['aria-label'] || (labelOnly ? undefined : props.placeholder || undefined)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(
            inputBase,
            // Mobile glass input: rounded-lg (radii.default), translucent glass
            // surface, soft border, aqua focus ring, 16px body text (avoids the
            // iOS focus-zoom). Override the shared inputBase defaults.
            'rounded-lg bg-bg-card border-border-input text-base',
            // Standardize on the outline focus affordance used by Button/IconButton/AuthTabs;
            // inputBase's own ring is inherited too, so cancel its width here.
            'focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
            isSearch && 'pl-10',
            error && 'border-accent-coral focus-visible:border-accent-coral focus-visible:outline-accent-coral',
            className,
          )}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors inline-flex items-center justify-center min-h-11 min-w-11"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            <span className="relative block w-5 h-5">
              <EyeOff className={cn(EYE_ICON, showPassword ? 'opacity-100' : EYE_HIDDEN)} aria-hidden="true" />
              <Eye className={cn(EYE_ICON, showPassword ? EYE_HIDDEN : 'opacity-100')} aria-hidden="true" />
            </span>
          </button>
        )}
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-[var(--color-text-danger)] mt-1 field-error-enter"
        >
          {error}
        </p>
      )}

      {helperText && !error && (
        <p id={helperId} className="text-sm text-text-muted mt-1">
          {helperText}
        </p>
      )}
    </div>
  );
}
