import React from 'react';
import { operatorConfig } from '../../../../utils/operatorConfig';

interface CollapsiblePrivacyNoticeProps {
  onCheckboxesChange: (allChecked: boolean) => void;
}

export const CollapsiblePrivacyNotice: React.FC<CollapsiblePrivacyNoticeProps> = ({
  onCheckboxesChange,
}) => {
  const [checkedTerms, setCheckedTerms] = React.useState(false);
  const [checkedCapacity, setCheckedCapacity] = React.useState(false);

  const updateTerms = (checked: boolean) => {
    setCheckedTerms(checked);
    onCheckboxesChange(checked && checkedCapacity);
  };
  const updateCapacity = (checked: boolean) => {
    setCheckedCapacity(checked);
    onCheckboxesChange(checkedTerms && checked);
  };

  return (
    <section className="mb-4 rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-200 shadow-md">
      <h2 className="border-b border-gray-700 pb-2 text-base font-semibold text-white">
        Aviso antes de intervenir
      </h2>
      <div className="mt-3 space-y-3 text-xs leading-relaxed text-gray-300">
        <p>
          La intervención se comparte con las personas conectadas. Evite comunicar información que no desee aportar a la sesión.
        </p>
        <p>
          El alias no verifica su identidad real. Se cifra para los Controles autorizados y solo se publica a otros participantes si usted lo permite.
        </p>
        <dl className="grid gap-2 rounded-lg border border-gray-700 bg-gray-900 p-3 sm:grid-cols-[8rem_1fr]">
          <dt className="font-semibold text-white">Operador</dt>
          <dd>{operatorConfig.operatorName}{operatorConfig.legalId ? `, ${operatorConfig.legalId}` : ''}</dd>
          <dt className="font-semibold text-white">Contacto</dt>
          <dd>{operatorConfig.rightsContact}</dd>
          <dt className="font-semibold text-white">Base jurídica</dt>
          <dd>{operatorConfig.legalBasis}</dd>
          <dt className="font-semibold text-white">Grabación</dt>
          <dd>
            {operatorConfig.recordingAvailable
              ? 'El estado concreto de esta sesión se mostrará antes de habilitar el micrófono.'
              : 'Esta instalación declara que la grabación no está disponible.'}
          </dd>
          <dt className="font-semibold text-white">Más información</dt>
          <dd><a href={operatorConfig.privacyUrl} className="text-blue-400 underline">Política de privacidad</a></dd>
        </dl>
      </div>

      <div className="mt-4 space-y-3 border-t border-gray-700 pt-3">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500"
            checked={checkedTerms}
            onChange={(event) => updateTerms(event.target.checked)}
          />
          <span>He leído y comprendido la información sobre privacidad e intervención pública.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500"
            checked={checkedCapacity}
            onChange={(event) => updateCapacity(event.target.checked)}
          />
          <span>Declaro poder participar o disponer de la autorización que resulte necesaria.</span>
        </label>
      </div>
    </section>
  );
};
