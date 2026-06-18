import React from 'react';
import { Shield } from 'lucide-react';

interface DataProtectionLinkProps {
  className?: string;
  text?: string;
}

export const DataProtectionLink: React.FC<DataProtectionLinkProps> = ({ 
  className = "text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 transition-colors",
  text = "Privacidad y protección de datos"
}) => {
  return (
    <a 
      href="/proteccion-datos" 
      target="_blank" 
      rel="noopener noreferrer"
      className={className}
      title="Información sobre privacidad y protección de datos"
    >
      <Shield className="w-3.5 h-3.5" />
      <span>{text}</span>
    </a>
  );
};
