import { useEffect, useRef, useState } from 'react';

export const useResizablePanel = () => {
  const [isVerticalLayout, setIsVerticalLayout] = useState(false);
  const [sidePanelSize, setSidePanelSize] = useState(45); // Default 45% for sidebar, leaving 55% for Hebrew
  const resizeStartRef = useRef<{ x: number; y: number; size: number } | null>(null);
  const resizePointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    const updateLayout = () => {
      setIsVerticalLayout(window.innerWidth < 768);
    };
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => {
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  const handleResizeMove = (e: PointerEvent) => {
    if (!resizeStartRef.current) return;
    if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
    e.preventDefault();
    if (isVerticalLayout) {
      // Sidebar on top: dragging down increases height
      const deltaY = e.clientY - resizeStartRef.current.y;
      const deltaVh = (deltaY / window.innerHeight) * 100;
      const next = resizeStartRef.current.size + deltaVh;
      setSidePanelSize(Math.max(20, Math.min(70, next)));
    } else {
      // Sidebar on left: dragging right increases width
      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaVw = (deltaX / window.innerWidth) * 100;
      const next = resizeStartRef.current.size + deltaVw;
      setSidePanelSize(Math.max(20, Math.min(65, next)));
    }
  };

  const handleResizeEnd = () => {
    resizeStartRef.current = null;
    resizePointerIdRef.current = null;
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', handleResizeEnd);
    window.removeEventListener('pointercancel', handleResizeEnd);
  };

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizePointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      size: sidePanelSize,
    };
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeEnd);
    window.addEventListener('pointercancel', handleResizeEnd);
  };

  return {
    isVerticalLayout,
    sidePanelSize,
    handleResizeStart,
  };
};
