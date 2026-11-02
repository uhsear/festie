import { useIOSInstall } from '../../hooks/useIOSInstall';
import IOSInstallDrawer from './IOSInstallDrawer';

/**
 * iOS "Add to Home Screen" sheet — built on the shared ui/Sheet (vaul) for native-feel
 * drag-dismiss and Escape handling. It is non-modal so it never
 * swallows taps. The hook gates it to a return visit (second session), 10s +
 * 1 interaction, and a 30-day cooldown.
 */
export default function IOSInstallSheet() {
  const { shouldShow, dismiss } = useIOSInstall();

  return <IOSInstallDrawer open={shouldShow} onClose={dismiss} />;
}
