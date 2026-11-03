import { useState } from 'react';
import { exportErrorMessage } from '@festie/shared/services/account';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { DATA_COPY } from '@festie/shared/constants';
import { useToast } from '../../lib/toastContext';
import { downloadExport } from '../../lib/downloadExport';
import Button from '../ui/Button';
import { Download } from 'lucide-react';

export default function DataExportSection() {
  const { toast } = useToast();
  const offlineMode = useUIStore((s) => s.offlineMode);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadExport();
      toast(DATA_COPY.done, 'success');
    } catch (err) {
      toast(exportErrorMessage(err), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <Download className="w-4 h-4" aria-hidden="true" />
        {DATA_COPY.title}
      </h3>

      <p className="text-sm text-text-muted">{DATA_COPY.hint}</p>

      <Button
        variant="outline"
        fullWidth
        isLoading={exporting}
        disabled={offlineMode}
        onClick={handleExport}
        className="min-h-[44px]"
      >
        {DATA_COPY.button}
      </Button>
    </section>
  );
}
