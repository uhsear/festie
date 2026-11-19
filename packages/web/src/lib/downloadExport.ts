import { fetchAccountExport } from '@festie/shared/services/account';

/** Saves a blob through a temporary anchor; the anchor joins the DOM so Firefox honours the click. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fetches the account export and saves it as festie-export-YYYY-MM-DD.json. Errors propagate. */
export async function downloadExport(): Promise<void> {
  const data = await fetchAccountExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  saveBlob(blob, `festie-export-${localDate(new Date())}.json`);
}
