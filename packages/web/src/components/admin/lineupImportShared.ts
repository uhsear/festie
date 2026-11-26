import { saveBlob } from '../../lib/downloadExport';

export const primaryButton =
  'px-4 py-2 rounded-xl bg-accent-aqua text-[var(--text-on-light-accent)] hover:opacity-80 disabled:opacity-50 transition-opacity text-sm font-medium';
export const secondaryButton =
  'px-4 py-2 rounded-xl bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 disabled:opacity-50 transition-colors text-sm font-medium';
export const inputClass =
  'w-full px-2 py-1 rounded bg-bg-primary border border-glass-border text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-aqua';

export const downloadText = (name: string, text: string) => saveBlob(new Blob([text], { type: 'text/csv' }), name);

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'festival';
