import { motion } from 'framer-motion';
import type { VerseData } from '../../hooks/useSeferReader';
import { sanitizeSlideHtml } from '../../utils/hebrewText';

interface SeferFlowViewProps {
  groupedVerses: { type: 'normal' | 'shira'; verses: { verse: VerseData; idxVerse: number }[] }[];
  selectedVerseIdx: number | null;
  rangeStartVerse?: string;
  rangeEndVerse?: string;
  onVerseClick: (e: React.MouseEvent, idx: number) => void;
  onVerseTouchEnd: (e: React.TouchEvent, idx: number) => void;
  bookDir?: string;
  hebrewFontSize?: number;
}

export const SeferFlowView = ({
  groupedVerses,
  selectedVerseIdx,
  rangeStartVerse,
  rangeEndVerse,
  onVerseClick,
  onVerseTouchEnd,
  bookDir = 'rtl',
  hebrewFontSize,
}: SeferFlowViewProps) => (
  <motion.div
    dir={bookDir}
    lang={bookDir === 'rtl' ? 'he' : undefined}
    className="sefer-mode max-w-(--breakpoint-xl) mx-auto text-[3.5rem] leading-[1.8] text-justify break-keep"
    style={{ fontSize: hebrewFontSize ? `${hebrewFontSize}px` : '42px' }}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 1 }}
  >
    <div className="whitespace-pre-wrap relative max-w-full">
      {groupedVerses.map((group, groupIdx) => {
        const renderVerse = (verse: VerseData, idxVerse: number) => {
          const isSelected = idxVerse === selectedVerseIdx;
          const verseNumber = Number(verse.verse);
          const startNumber = Number(rangeStartVerse ?? verse.verse);
          const endNumber = Number(rangeEndVerse ?? rangeStartVerse ?? verse.verse);
          const hasRange = Number.isFinite(startNumber) && Number.isFinite(endNumber);
          const isWithinRange = !hasRange || (verseNumber >= Math.min(startNumber, endNumber) && verseNumber <= Math.max(startNumber, endNumber));
          const textToShow = isSelected
            ? (verse.verseNikudSanitized ?? verse.verseNikud)
            : (verse.verseNikudCleanSanitized ?? verse.verseNikudSanitized ?? verse.verseNikudClean ?? verse.verseNikud);

          const hasBricks = textToShow.includes('brick-');
          const classNameVerse = isSelected
            ? `text-red-900 font-semibold verse-selected ${hasBricks ? 'verse-shira' : 'bg-yellow-100 px-2 rounded-sm'}`
            : `${isWithinRange ? 'text-gray-800' : 'text-gray-500/70'} ${hasBricks ? 'verse-shira' : ''}`;

          const htmlString = sanitizeSlideHtml(`${textToShow} `.replace(/<br\s*\/?>\s+/gi, '<br/>'));

          return (
            <span
              key={idxVerse}
              id={`verse-${idxVerse}`}
              className={`inline transition-all duration-500 ${classNameVerse}`}
              onClick={(e) => onVerseClick(e, idxVerse)}
              onTouchEnd={(e) => onVerseTouchEnd(e, idxVerse)}
            >
              <span dangerouslySetInnerHTML={{ __html: htmlString }} />
            </span>
          );
        };

        if (group.type === 'shira') {
          return (
            <div key={`group-${groupIdx}`} className="shira-flow">
              {group.verses.map(({ verse, idxVerse }) => renderVerse(verse, idxVerse))}
            </div>
          );
        }
        return (
          <span key={`group-${groupIdx}`}>
            {group.verses.map(({ verse, idxVerse }) => renderVerse(verse, idxVerse))}
          </span>
        );
      })}
    </div>
  </motion.div>
);
