import React, { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

interface AutoResizeTextProps {
  text: string;
  className?: string;
  maxFontSize?: number;
  minFontSize?: number;
  fontScale?: number;
  baseFontSize?: number;
  html?: boolean;
  allowGrow?: boolean;
}

const AutoResizeText: React.FC<AutoResizeTextProps> = ({
  text,
  className = '',
  maxFontSize = 100, // Let CSS clamp handle the initial large sizes if possible, or use a high max
  minFontSize = 12,
  fontScale = 1,
  baseFontSize,
  html = false,
  allowGrow = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState<number | undefined>(undefined);

  const cleanText = useMemo(() => {
    if (!html) return text;
    return DOMPurify.sanitize(text, {
      ALLOWED_TAGS: ['br', 'span', 'sup', 'i', 'b', 'strong', 'em', 'u', 'small', 'mark', 'ruby', 'rt', 'rp', 'big', 'div'],
      ALLOWED_ATTR: ['class', 'dir', 'lang', 'title', 'data-comment'],
    });
  }, [text, html]);

  useEffect(() => {
    const resizeText = () => {
      if (!containerRef.current || !textRef.current) return;

      const containerHeight = containerRef.current.clientHeight;
      const containerWidth = containerRef.current.clientWidth;
      if (containerHeight === 0 || containerWidth === 0) return;

      if (allowGrow) {
        // Reset style to get the original/computed base size
        textRef.current.style.fontSize = '';
        
        const parentStyle = window.getComputedStyle(containerRef.current);
        const parentSize = parseFloat(parentStyle.fontSize);
        
        const computedStyle = window.getComputedStyle(textRef.current);
        const computedSize = parseFloat(computedStyle.fontSize);

        // Determine if a custom font size is applied via classes/inline styles
        const hasCustomSize = Math.abs(computedSize - parentSize) > 0.1;
        
        const targetMin = minFontSize * fontScale;
        // If baseFontSize is specified, use that. If custom CSS size is found, use computedSize. Otherwise use maxFontSize.
        const targetMax = (baseFontSize !== undefined ? baseFontSize : (hasCustomSize ? computedSize : maxFontSize)) * fontScale;

        let low = Math.max(1, targetMin);
        let high = Math.max(low, targetMax);
        let optimal = low;

        // Binary search for the largest size that fits
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          textRef.current.style.fontSize = `${mid}px`;
          
          if (textRef.current.scrollHeight <= containerHeight && textRef.current.scrollWidth <= containerWidth) {
            optimal = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }

        setFontSize(optimal);
      } else {
        // Original logic for backwards compatibility
        if (baseFontSize !== undefined) {
          textRef.current.style.fontSize = `${baseFontSize}px`;
        } else {
          textRef.current.style.fontSize = '';
        }
        
        const computedStyle = window.getComputedStyle(textRef.current);
        const computedSize = parseFloat(computedStyle.fontSize);
        const initialSize = baseFontSize ?? computedSize;

        if (textRef.current.scrollHeight <= containerHeight && textRef.current.scrollWidth <= containerWidth) {
          setFontSize(baseFontSize !== undefined ? initialSize : undefined);
          return;
        }

        // If it overflows, start shrinking from the computed size
        let currentSize = initialSize;

        while (
          currentSize > minFontSize &&
          (textRef.current.scrollHeight > containerHeight || textRef.current.scrollWidth > containerWidth)
        ) {
          currentSize -= 1;
          textRef.current.style.fontSize = `${currentSize}px`;
        }

        setFontSize(currentSize);
      }
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
  }, [cleanText, maxFontSize, minFontSize, fontScale, baseFontSize, allowGrow]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden">
      {html ? (
        <div
          ref={textRef}
          className={`${className} text-center leading-tight whitespace-pre-wrap`}
          style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
          dangerouslySetInnerHTML={{ __html: cleanText }}
        />
      ) : (
        <div
          ref={textRef}
          className={`${className} text-center leading-tight whitespace-pre-wrap`}
          style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
        >
          {text}
        </div>
      )}
    </div>
  );
};

export default AutoResizeText;
