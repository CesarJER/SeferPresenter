import { motion } from 'framer-motion';
import AutoResizeText from '../shared/AutoResizeText';

interface VerseSidebarProps {
  combinedText: string;
  combinedTextBaseSize?: number;
  selectedVerseIdx: number | null;
  lastSelectedIdx: React.MutableRefObject<number | null>;
  scrollToTarget: (idx: number) => void;
  isVerticalLayout: boolean;
  sidePanelSize: number;
  handleResizeStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  navLabel?: string;
}

export const VerseSidebar = ({
  combinedText,
  combinedTextBaseSize = 40,
  selectedVerseIdx,
  lastSelectedIdx,
  scrollToTarget,
  isVerticalLayout,
  sidePanelSize,
  handleResizeStart,
  navLabel,
}: VerseSidebarProps) => {
  if (!combinedText) return null;

  return (
    <motion.div
      className="relative overflow-hidden min-w-full md:min-w-[200px] min-h-[25vh] md:min-h-full bg-white/95 shadow-xl text-base z-50 flex flex-col justify-center border-b md:border-r md:border-b-0 border-amber-300"
      style={{
        width: isVerticalLayout ? '100%' : `${sidePanelSize}vw`,
        height: isVerticalLayout ? `${sidePanelSize}vh` : '100%',
        maxWidth: isVerticalLayout ? undefined : '65vw',
        maxHeight: isVerticalLayout ? '70vh' : undefined,
      }}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5 }}
      onAnimationComplete={() => {
        const targetIdx = selectedVerseIdx ?? lastSelectedIdx.current;
        if (targetIdx !== null) {
          scrollToTarget(targetIdx);
        }
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        className="hidden md:block touch-none absolute right-0 top-0 h-full w-4 cursor-col-resize bg-transparent hover:bg-amber-300/40 active:bg-amber-400/50 z-[60]"
        onPointerDown={handleResizeStart}
      />
      <div
        role="separator"
        aria-orientation="horizontal"
        className="md:hidden touch-none absolute bottom-0 left-0 w-full h-6 cursor-row-resize bg-transparent active:bg-amber-400/50 z-[60]"
        onPointerDown={handleResizeStart}
      />

      {navLabel && (
        <div className="absolute left-0 right-0 top-0 z-[55] border-b border-amber-900/20 bg-[#f7e7b6]/95 px-4 py-2 text-5xl text-center font-bold text-amber-950 shadow-sm">
          {navLabel}
        </div>
      )}

      <div className="flex flex-col text-center h-full">
        <div className={`flex-1 flex items-center justify-center overflow-hidden m-3 ${navLabel ? 'mt-14' : ''}`}>
          <AutoResizeText
            text={combinedText}
            baseFontSize={combinedTextBaseSize}
            maxFontSize={70}
            minFontSize={12}
            className="text-gray-900"
            html={true}
          />
        </div>
      </div>
    </motion.div>
  );
};
