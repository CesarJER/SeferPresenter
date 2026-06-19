import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsiblePrivacyNoticeProps {
  onCheckboxesChange: (allChecked: boolean) => void;
  orgName?: string;
}

export const CollapsiblePrivacyNotice: React.FC<CollapsiblePrivacyNoticeProps> = ({ 
  onCheckboxesChange,
  orgName = import.meta.env.VITE_ORGANIZATION_NAME || "la Comunidad"
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [checkedTerms, setCheckedTerms] = useState(false);
  const [checkedCapacity, setCheckedCapacity] = useState(false);

  const handleTermsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCheckedTerms(e.target.checked);
    onCheckboxesChange(e.target.checked && checkedCapacity);
  };

  const handleCapacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCheckedCapacity(e.target.checked);
    onCheckboxesChange(checkedTerms && e.target.checked);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-200 shadow-md mb-4 border border-gray-700">
      <div 
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="font-semibold text-white">Aviso antes de intervenir</span>
        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </div>
      
      {isExpanded && (
        <div className="mt-3 space-y-3 text-gray-300 text-xs leading-relaxed">
          <p>
            Esta reunión puede ser grabada y difundida por {orgName} a través de sus canales oficiales.
          </p>
          <p>
            Por favor, evite compartir información personal o cualquier otra información que no desee que pueda formar parte de la grabación.
          </p>
          <p>
            Si interviene mediante el micrófono, su intervención podrá ser escuchada por los asistentes y su voz podrá formar parte de dichas grabaciones.
          </p>
          <p>
            El alias temporal y los mensajes privados dirigidos a Control solo serán visibles para Control y los Controles autorizados durante la sesión. No obstante, Control podrá mencionar, leer o responder públicamente al contenido de su mensaje o alias durante la reunión de forma pública para poder atender su petición.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-gray-700 pt-3">
        <label className="flex items-start gap-2 cursor-pointer group">
          <input 
            type="checkbox" 
            className="mt-1 w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 bg-gray-700"
            checked={checkedTerms}
            onChange={handleTermsChange}
          />
          <span className="text-xs group-hover:text-white transition-colors">
            He leído y acepto las condiciones sobre privacidad, grabaciones e intervención pública.
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer group">
          <input 
            type="checkbox" 
            className="mt-1 w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 bg-gray-700"
            checked={checkedCapacity}
            onChange={handleCapacityChange}
          />
          <span className="text-xs group-hover:text-white transition-colors">
            Declaro tener capacidad para participar en esta actividad o, cuando sea legalmente necesario, contar con la autorización de mis padres, tutores o representantes legales.
          </span>
        </label>
      </div>
    </div>
  );
};
