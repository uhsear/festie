import type { Ionicons } from '@expo/vector-icons';
import type { ExpenseIconKey } from '@festie/shared/constants';

// Ionicons for the shared expense category icon keys (web maps the same keys to Lucide).
export const EXPENSE_IONICON: Record<ExpenseIconKey, keyof typeof Ionicons.glyphMap> = {
  utensils: 'restaurant',
  beer: 'beer',
  car: 'car',
  bed: 'bed',
  ticket: 'ticket',
  wallet: 'wallet',
};
