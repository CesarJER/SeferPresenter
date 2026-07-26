import React, { useState, useRef, useEffect } from 'react';

export interface CustomSearchSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  className?: string;
  dropdownWidthClass?: string;
  openDirection?: 'up' | 'down';
}

export const CustomSearchSelect: React.FC<CustomSearchSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar...',
  className = '',
  dropdownWidthClass = 'w-full',
  openDirection = 'down'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear search and focus input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      const timer = setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const selectedOption = options.find(opt => opt.value === value);

  const filtered = options.filter(opt =>
    opt.label.toLowerCase().includes(search.toLowerCase()) ||
    opt.value.toLowerCase().includes(search.toLowerCase())
  );

  const directionClass = openDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Select Box Trigger */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white hover:bg-gray-800 focus:ring-1 focus:ring-yellow-500 cursor-pointer select-none"
      >
        <span className={selectedOption ? 'text-white' : 'text-gray-500 font-medium'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="text-gray-400 text-xs ml-2 select-none pointer-events-none">▼</span>
      </div>

      {/* Dropdown container */}
      {isOpen && (
        <div className={`absolute left-0 z-[9999] rounded-md border border-gray-700 bg-gray-950/95 backdrop-blur-md shadow-2xl flex flex-col p-1.5 gap-1.5 ${directionClass} ${dropdownWidthClass}`}>
          {/* Search box inside dropdown */}
          <div className="relative flex items-center bg-gray-900 border border-gray-750 rounded px-2.5 py-1.5">
            <input
              ref={searchInputRef}
              type="text"
              className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-gray-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              onClick={(e) => e.stopPropagation()} // Prevent clicking search from closing dropdown
            />
            {search && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearch('');
                  if (searchInputRef.current) {
                    searchInputRef.current.focus();
                  }
                }}
                className="text-gray-500 hover:text-white text-xs px-1 select-none cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Option items list */}
          <div className="max-h-[12rem] overflow-y-auto divide-y divide-gray-900 custom-scrollbar flex flex-col">
            {filtered.length > 0 ? (
              filtered.map(opt => (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`px-3 py-2 text-xs text-gray-200 hover:bg-yellow-600 hover:text-white transition-colors cursor-pointer rounded-sm ${opt.value === value ? 'bg-yellow-600/20 text-yellow-500 border-l-2 border-yellow-500 font-bold' : ''
                    }`}
                >
                  {opt.label}
                </div>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-gray-500 text-center">
                Sin resultados
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
