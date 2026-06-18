import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';

interface DataProtectionLinkProps {
  className?: string;
  text?: string;
}

export const DataProtectionLink: React.FC<DataProtectionLinkProps> = ({ 
  className = "text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-all duration-300 ease-in-out",
  text = "Privacidad y protección de datos"
}) => {
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
      title="Información sobre privacidad y protección de datos"
    >
      <Shield className="w-3.5 h-3.5 flex-shrink-0" />
      <span 
        className={`transition-all duration-500 ease-in-out overflow-hidden whitespace-nowrap ${
          isCollapsed 
            ? 'max-w-0 group-hover:max-w-[15rem] opacity-0 group-hover:opacity-100 group-hover:ml-1' 
            : 'max-w-[15rem] opacity-100 ml-1'
        }`}
      >
        {text}
      </span>
    </a>
  );
};

