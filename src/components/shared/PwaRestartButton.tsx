import { RotateCcw, Wifi } from 'lucide-react';
import { restartPwaApp } from '../../utils/pwaUpdate';

interface PwaRestartButtonProps {
  className?: string;
}

export const PwaRestartButton = ({ className = '' }: PwaRestartButtonProps) => (
  <button
    type="button"
    onClick={() => {
      void restartPwaApp();
    }}
    className={`group inline-flex items-center justify-center rounded-md border border-white/15 bg-black/45 p-2 text-white/75 shadow-lg backdrop-blur-sm transition-colors hover:bg-black/65 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60 ${className}`}
    title="Reiniciar app"
    aria-label="Reiniciar app"
  >
    <Wifi size={15} className="group-hover:hidden" />
    <RotateCcw size={15} className="hidden group-hover:block" />
  </button>
);
