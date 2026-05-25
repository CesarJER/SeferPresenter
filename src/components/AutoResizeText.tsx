import React, { useEffect, useRef, useState } from 'react';

interface AutoResizeTextProps {
  text: string;
  className?: string;
  maxFontSize?: number;
  minFontSize?: number;
  fontScale?: number;
}

const AutoResizeText: React.FC<AutoResizeTextProps> = ({
  text,
  className = '',
  maxFontSize = 100, // Let CSS clamp handle the initial large sizes if possible, or use a high max
  minFontSize = 12,
  fontScale = 1,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState<number | undefined>(undefined);

  useEffect(() => {
    const resizeText = () => {
      if (!containerRef.current || !textRef.current) return;

      // Reset to the container's default CSS font size before measuring
      textRef.current.style.fontSize = '';
      
      const computedStyle = window.getComputedStyle(textRef.current);
      const computedSize = parseFloat(computedStyle.fontSize);
      
      const containerHeight = containerRef.current.clientHeight;
      const containerWidth = containerRef.current.clientWidth;

      if (textRef.current.scrollHeight <= containerHeight && textRef.current.scrollWidth <= containerWidth) {
        setFontSize(undefined); // Reset to CSS default
        return;
      }

      // If it overflows, start shrinking from the computed size
      let currentSize = computedSize;

      while (
        currentSize > minFontSize &&
        (textRef.current.scrollHeight > containerHeight || textRef.current.scrollWidth > containerWidth)
      ) {
        currentSize -= 1;
        textRef.current.style.fontSize = `${currentSize}px`;
      }

      setFontSize(currentSize);
    };

    resizeText();

    const observer = new ResizeObserver(() => {
      resizeText();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', resizeText);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeText);
    };
  }, [text, maxFontSize, minFontSize, fontScale]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden">
      <div
        ref={textRef}
        className={`${className} text-center leading-tight whitespace-pre-wrap`}
        style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
      >
        {text}
      </div>
    </div>
  );
};

export default AutoResizeText;
