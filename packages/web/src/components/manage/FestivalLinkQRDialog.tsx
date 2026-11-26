import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { colors } from '@festie/shared/tokens';
import Dialog from '../ui/Dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  festivalName: string;
  /** The public festival link. */
  link: string;
}

/** The public festival link as a QR code, for a poster or a screen. Dark on light in every theme so cameras lock on. */
export default function FestivalLinkQRDialog({ open, onOpenChange, festivalName, link }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`QR code for ${festivalName}`}>
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-lg bg-white p-4" data-testid="festival-link-qr" role="img" aria-label={`QR code for ${link}`}>
          <QRCodeSVG value={link} size={240} level="M" fgColor={colors.bg.primary} bgColor="#FFFFFF" marginSize={0} />
        </div>
        <p className="text-sm text-text-secondary text-center">Point a phone camera at the code to open the festival.</p>
        <p className="break-all text-center text-xs text-text-muted">{link}</p>
      </div>
    </Dialog>
  );
}
