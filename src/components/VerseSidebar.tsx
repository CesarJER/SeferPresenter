import { motion } from 'framer-motion';
import AutoResizeText from './AutoResizeText';

interface VerseSidebarProps {
  combinedText: string;
  selectedVerseIdx: number | null;
  lastSelectedIdx: React.MutableRefObject<number | null>;
  scrollToTarget: (idx: number) => void;
  isVerticalLayout: boolean;
  sidePanelSize: number;
  handleResizeStart: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export const VerseSidebar = ({
  combinedText,
  selectedVerseIdx,
  lastSelectedIdx,
  scrollToTarget,
  isVerticalLayout,
  sidePanelSize,
  handleResizeStart,
}: VerseSidebarProps) => {
  if (!combinedText) return null;

  return (
    <motion.div
      className="relative overflow-hidden min-w-full md:min-w-[200px] min-h-[25vh] md:min-h-full bg-white/90 md:p-8 shadow-xl text-base z-50 flex flex-col justify-center border-t md:border-l border-amber-300"
      style={{
        width: isVerticalLayout ? '100%' : `${sidePanelSize}vw`,
        height: isVerticalLayout ? `${sidePanelSize}vh` : '100%',
        maxWidth: isVerticalLayout ? undefined : '55vw',
        maxHeight: isVerticalLayout ? '70vh' : undefined,
      }}
      initial={{ opacity: 0, x: 20 }}
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
        className="hidden md:block touch-none absolute left-0 top-0 h-full w-4 cursor-col-resize bg-transparent hover:bg-amber-300/40 active:bg-amber-400/50 z-[60]"
        onPointerDown={handleResizeStart}
      />
      <div
        role="separator"
        aria-orientation="horizontal"
        className="md:hidden touch-none absolute top-0 left-0 w-full h-6 cursor-row-resize bg-transparent active:bg-amber-400/50 z-[60]"
        onPointerDown={handleResizeStart}
      />

      <div className="flex flex-col text-center h-full">
        <div className="flex-1 flex items-center justify-center overflow-hidden m-3">
          <AutoResizeText
            text={combinedText}
            maxFontSize={36}
            minFontSize={12}
            className="text-gray-900"
            html={true}
          />
        </div>
      </div>
    </motion.div>
  );
};
