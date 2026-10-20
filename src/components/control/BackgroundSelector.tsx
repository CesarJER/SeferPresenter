import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React from 'react';
import { Lock, Unlock } from 'lucide-react';
import { CustomSearchSelect } from '../shared/CustomSearchSelect';
import type { Presentation } from '../../types/presentation';

interface BackgroundSelectorProps {
  activeBackground: string;
  currentPresentation: Presentation | null;
  backgrounds: string[];
  onSelectBackgroundOverride: (bg: string) => void;
  backgroundLock: boolean;
  onToggleBackgroundLock: (lock: boolean) => void;
}

export const BackgroundSelector: React.FC<BackgroundSelectorProps> = ({
  activeBackground,
  currentPresentation,
  backgrounds,
  onSelectBackgroundOverride,
  backgroundLock,
  onToggleBackgroundLock
}) => {
  useUiTranslation('control');
  return (
    <div className="flex-1 space-y-1.5 min-w-0">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{translate("control:BackgroundSelector.background", "Fondo")}</label>
      <div className="flex gap-1.5">
        <CustomSearchSelect
          value={activeBackground || (currentPresentation ? currentPresentation.background : backgrounds[0])}
          onChange={(val) => {
            onSelectBackgroundOverride(val);
          }}
          options={backgrounds.map(background => ({
            label: background.split('/').pop() || background,
            value: background
          }))}
          placeholder={translate("control:BackgroundSelector.globalBackground", "Fondo global...")}
          dropdownWidthClass="w-[200px]"
        />
        <button
          type="button"
          onClick={() => onToggleBackgroundLock(!backgroundLock)}
          className={`px-3 rounded-md border flex items-center justify-center transition-all cursor-pointer ${backgroundLock
            ? 'bg-red-600 border-red-500 text-white hover:bg-red-500 shadow-md shadow-red-500/20 animate-pulse'
            : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'
            }`}
          title={
            backgroundLock
              ? translate("control:BackgroundSelector.lockEnabledBackgroundFrozenImportantStyle", "Candado Activo: Fondo congelado (estilo !important)")
              : translate("control:BackgroundSelector.lockDisabledSlidesFreelyControlTheBackground", "Candado Inactivo: Diapositivas controlan el fondo libremente")
          }
        >
          {backgroundLock ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
      </div>
    </div>
  );
};
