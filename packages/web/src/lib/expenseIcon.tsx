import type { LucideIcon } from 'lucide-react';
import { Utensils, Beer, Car, BedDouble, Ticket, Wallet } from 'lucide-react';
import type { ExpenseIconKey } from '@festie/shared/constants';

const ICONS: Record<ExpenseIconKey, LucideIcon> = {
  utensils: Utensils,
  beer: Beer,
  car: Car,
  bed: BedDouble,
  ticket: Ticket,
  wallet: Wallet,
};

export function ExpenseIcon({ icon, className = 'w-5 h-5' }: { icon: ExpenseIconKey; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden="true" />;
}
