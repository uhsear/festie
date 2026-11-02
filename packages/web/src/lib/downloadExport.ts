import { fetchAccountExport } from '@festie/shared/services/account';

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fetches the account export and saves it as festie-export-YYYY-MM-DD.json. Errors propagate. */
export async function downloadExport(): Promise<void> {
  const data = await fetchAccountExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `festie-export-${localDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
