import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';

interface DataProtectionLinkProps {
  className?: string;
  text?: string;
}

export const DataProtectionLink: React.FC<DataProtectionLinkProps> = ({ 
  className = "text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-all duration-300 ease-in-out",
  text = translate("common:DataProtectionLink.privacyAndDataProtection", "Privacidad y protección de datos")
}) => {
  useUiTranslation('common');
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsCollapsed(true);
    }, 4000); // colapsar después de 4 segundos
    return () => clearTimeout(timer);
  }, []);

  return (
    <a 
      href="/proteccion-datos" 
      target="_blank" 
      rel="noopener noreferrer"
      className={`${className} group relative overflow-hidden`}
      title={translate("common:DataProtectionLink.privacyAndDataProtectionInformation", "Información sobre privacidad y protección de datos")}
    >
      <Shield className="w-3.5 h-3.5 shrink-0" />
      <span 
        className={`transition-all duration-500 ease-in-out overflow-hidden whitespace-nowrap ${
          isCollapsed 
            ? 'max-w-0 group-hover:max-w-60 opacity-0 group-hover:opacity-100 group-hover:ms-1'
            : 'max-w-60 opacity-100 ms-1'
        }`}
      >
        {text}
      </span>
    </a>
  );
};

