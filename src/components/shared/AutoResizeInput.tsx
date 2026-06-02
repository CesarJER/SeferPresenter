import React, { useRef, useState, useCallback, useEffect } from 'react';

export interface AutoResizeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  minFontSize?: number;
  maxFontSize?: number;
}

export const AutoResizeInput: React.FC<AutoResizeInputProps> = ({
  minFontSize = 8,
  maxFontSize = 12,
  value,
  className = '',
  style,
  ...props
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fontSize, setFontSize] = useState<number>(maxFontSize);

  const adjustFontSize = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.fontSize = `${maxFontSize}px`;
    const containerWidth = input.clientWidth;
    if (containerWidth === 0) return;

    let currentSize = maxFontSize;
    while (currentSize > minFontSize && input.scrollWidth > containerWidth) {
      currentSize -= 0.5;
      input.style.fontSize = `${currentSize}px`;
    }
    setFontSize(currentSize);
  }, [maxFontSize, minFontSize]);

  useEffect(() => {
    adjustFontSize();
  }, [value, adjustFontSize]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const observer = new ResizeObserver(() => {
      adjustFontSize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [adjustFontSize]);

  return (
    <input
      ref={inputRef}
      className={className}
      value={value}
      style={{ ...style, fontSize: `${fontSize}px` }}
      {...props}
    />
  );
};

export interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minFontSize?: number;
  maxFontSize?: number;
}

export const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({
  minFontSize = 8,
  maxFontSize = 12,
  value,
  className = '',
  style,
  ...props
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fontSize, setFontSize] = useState<number>(maxFontSize);

  const adjustFontSize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.fontSize = `${maxFontSize}px`;
    const containerHeight = textarea.clientHeight;
    const containerWidth = textarea.clientWidth;
    if (containerHeight === 0 || containerWidth === 0) return;

    let currentSize = maxFontSize;
    while (
      currentSize > minFontSize &&
      (textarea.scrollHeight > containerHeight || textarea.scrollWidth > containerWidth)
    ) {
      currentSize -= 0.5;
      textarea.style.fontSize = `${currentSize}px`;
    }
    setFontSize(currentSize);
  }, [maxFontSize, minFontSize]);

  useEffect(() => {
    adjustFontSize();
  }, [value, adjustFontSize]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const observer = new ResizeObserver(() => {
      adjustFontSize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [adjustFontSize]);

  return (
    <textarea
      ref={textareaRef}
      className={className}
      value={value}
      style={{ ...style, fontSize: `${fontSize}px`, overflow: 'hidden' }}
      {...props}
    />
  );
};
