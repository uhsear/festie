import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { buildJoinUrl } from '@festie/shared/utils';
import Dialog from '../ui/Dialog';

interface InviteQRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewName: string;
  code: string;
}

/** Invite QR for friends standing next to you. The shared Dialog shell supplies the Close button. */
export default function InviteQRDialog({ open, onOpenChange, crewName, code }: InviteQRDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Scan to join ${crewName}`}>
      <div className="flex flex-col items-center gap-3">
        {/* Dark on light in every theme so cameras lock on in dark mode. */}
        <div
          className="rounded-xl bg-white p-4"
          data-testid="invite-qr-code"
          role="img"
          aria-label={`QR code to join ${crewName}`}
        >
          <QRCodeSVG
            value={buildJoinUrl(code, window.location.origin)}
            size={240}
            level="M"
            fgColor="#080810"
            bgColor="#FFFFFF"
            marginSize={0}
          />
        </div>
        <p className="text-sm text-text-secondary text-center">Point a phone camera at the code.</p>
        <p className="text-lg font-mono tracking-widest text-text-primary">{code}</p>
      </div>
    </Dialog>
  );
}
