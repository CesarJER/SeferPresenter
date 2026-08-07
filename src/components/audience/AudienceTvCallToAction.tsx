import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface AudienceTvCallToActionProps {
  domain: string;
}

const AudienceTvCallToAction: React.FC<AudienceTvCallToActionProps> = ({ domain }) => {
  const [qrExpanded, setQrExpanded] = useState(false);
  const url = `https://${domain}`;

  return (
    <>
      {qrExpanded && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center p-4 cursor-pointer"
          onClick={() => setQrExpanded(false)}
          data-testid="tv-qr-overlay"
        >
          <div className="bg-white p-8 rounded-2xl flex flex-col items-center gap-6 shadow-2xl pointer-events-auto">
            <QRCodeSVG value={url} size={300} />
            <div className="text-3xl font-bold text-black select-all">{url}</div>
          </div>
        </div>
      )}

      <div
        className="w-full shrink-0 max-h-[50px] bg-black/90 text-white p-3 z-50 flex items-center justify-between border-t border-white/10 pointer-events-auto"
        data-testid="tv-cta-banner"
      >
        <div className="text-[clamp(1rem,3vw,1.4rem)] font-medium flex-1 text-center md:text-left px-4">
          ¡Retransmisión en directo! No te quedes solo viendo. Participa con nosotros. Conéctate a <span className="font-bold text-yellow-400">{domain}</span>
        </div>
        <div
          className="bg-white p-2 rounded cursor-pointer hover:scale-105 transition-transform self-end"
          onClick={() => setQrExpanded(true)}
          data-testid="tv-qr-trigger"
        >
          <QRCodeSVG value={url} size={48} />
        </div>
      </div>
    </>
  );
};

export default AudienceTvCallToAction;
