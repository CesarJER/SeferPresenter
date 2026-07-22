import React, { useState, useRef, useEffect, useId } from 'react';

export interface CustomSearchSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  className?: string;
  dropdownWidthClass?: string;
  openDirection?: 'up' | 'down';
  ariaLabel?: string;
}

export const CustomSearchSelect: React.FC<CustomSearchSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar...',
  className = '',
  dropdownWidthClass = 'w-full',
  openDirection = 'down',
  ariaLabel
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

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

  const closeAndRestoreFocus = () => {
    setIsOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const focusOption = (index: number) => {
    const boundedIndex = Math.max(0, Math.min(index, filtered.length - 1));
    optionRefs.current[boundedIndex]?.focus();
  };

  const selectOption = (optionValue: string) => {
    onChange(optionValue);
    closeAndRestoreFocus();
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(filtered.length - 1);
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(filtered[index].value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(filtered.length - 1);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Select Box Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        role="combobox"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white hover:bg-gray-800 focus:ring-1 focus:ring-yellow-500 cursor-pointer select-none"
      >
        <span className={selectedOption ? 'text-white' : 'text-gray-500 font-medium'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="text-gray-400 text-xs ml-2 select-none pointer-events-none">▼</span>
      </button>

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
              aria-label={`Buscar en ${ariaLabel ?? placeholder}`}
              aria-controls={listboxId}
              onKeyDown={handleSearchKeyDown}
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
                aria-label="Limpiar busqueda"
              >
                ✕
              </button>
            )}
          </div>

          {/* Option items list */}
          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? placeholder}
            className="max-h-[12rem] overflow-y-auto divide-y divide-gray-900 custom-scrollbar flex flex-col"
          >
            {filtered.length > 0 ? (
              filtered.map((opt, index) => (
                <button
                  key={opt.value}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  onClick={() => selectOption(opt.value)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  className={`px-3 py-2 text-xs text-gray-200 hover:bg-yellow-600 hover:text-white transition-colors cursor-pointer rounded-sm ${opt.value === value ? 'bg-yellow-600/20 text-yellow-500 border-l-2 border-yellow-500 font-bold' : ''
                    }`}
                >
                  {opt.label}
                </button>
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
