import { type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------------------
 * Variant & padding maps
 * -------------------------------------------------------------------------*/

const variantStyles = {
  default: 'bg-bg-card border border-border rounded-lg transition-[translate,box-shadow] duration-(--duration-med)',
  elevated: 'bg-bg-card border border-border rounded-lg shadow-lg transition-[translate,box-shadow] duration-(--duration-med)',
  interactive:
    'bg-bg-card border border-border rounded-lg cursor-pointer transition-[translate,scale,background-color,box-shadow] duration-(--duration-med) ease-out hover:-translate-y-0.5 hover:bg-bg-card-hover press-scale motion-reduce:transition-none motion-reduce:hover:translate-y-0',
  flush: 'bg-bg-card border border-border rounded-lg transition-[translate,box-shadow] duration-(--duration-med)',
  // A hairline-ruled block on the page ground: no fill, no frame, no radius (Account).
  section: 'border-b border-border-light py-4 first:pt-0',
} as const;

const paddingStyles = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

/* ---------------------------------------------------------------------------
 * Card root
 * -------------------------------------------------------------------------*/

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variantStyles;
  padding?: keyof typeof paddingStyles;
  ref?: Ref<HTMLDivElement>;
}

function CardRoot({ variant = 'default', padding = variant === 'section' ? 'none' : 'md', className, ref, ...props }: CardProps) {
  return <div ref={ref} className={cn(variantStyles[variant], paddingStyles[padding], className)} {...props} />;
}

/* ---------------------------------------------------------------------------
 * Compound sub-components
 * -------------------------------------------------------------------------*/

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

function Header({ className, ref, ...props }: CardSectionProps) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-3 mb-3 pb-3 border-b border-border-light', className)}
      {...props}
    />
  );
}

function Body({ className, ref, ...props }: CardSectionProps) {
  return <div ref={ref} className={cn('flex-1', className)} {...props} />;
}

function Footer({ className, ref, ...props }: CardSectionProps) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-3 mt-3 pt-3 border-t border-border-light', className)}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------------------
 * Compose & export
 * -------------------------------------------------------------------------*/

export const Card = Object.assign(CardRoot, {
  Header,
  Body,
  Footer,
});
