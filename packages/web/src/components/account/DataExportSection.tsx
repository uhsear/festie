import { useState } from 'react';
import { api, mapErrorToUserMessage } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import { Download } from 'lucide-react';

export default function DataExportSection() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.get<Record<string, unknown>>('/account/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `festie-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Export downloaded', 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, "Couldn't export data. Try again."), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <Download className="w-4 h-4" aria-hidden="true" />
        Export Data
      </h3>

      <p className="text-sm text-text-muted">
        Download all your data in JSON format.
      </p>

      <Button
        variant="outline"
        fullWidth
        isLoading={exporting}
        onClick={handleExport}
        className="min-h-[44px]"
      >
        Download My Data
      </Button>
    </section>
  );
}
