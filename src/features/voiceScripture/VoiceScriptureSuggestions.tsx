import type { VoiceScriptureCandidate } from './voiceScriptureParser';
import { candidateLabel } from './voiceScriptureProjection';

/** Presentation only: moving this view never stops the audio session. */
export function VoiceScriptureSuggestions({ status, options, onProject }: {
  status: string;
  options: VoiceScriptureCandidate[];
  onProject: (candidate: VoiceScriptureCandidate) => void;
}) {
  return <div aria-label="Asistente de voz" className="max-h-28 overflow-auto p-2 text-xs text-gray-300">
    <div role="status">{status}</div>
    {options.length > 0 && <div aria-label="Referencias detectadas" className="mt-1 flex flex-wrap gap-1">
      {options.flatMap((candidate, index) => {
        const buttons = [
          <button type="button" className="rounded-sm bg-emerald-800 px-2 py-1"
            key={`${candidateLabel(candidate)}-${index}`} onClick={() => onProject(candidate)}>
            {candidateLabel(candidate)}
          </button>
        ];

        // ponytail: simple expansion for ranges up to 50 verses
        if (candidate.verseEnd > candidate.verseStart && candidate.verseEnd - candidate.verseStart < 50) {
          for (let i = candidate.verseStart; i <= candidate.verseEnd; i++) {
            buttons.push(
              <button type="button" className="rounded-sm bg-emerald-700/80 px-2 py-1"
                key={`single-${index}-${i}`} 
                onClick={() => onProject({ ...candidate, verse: i })}>
                {i}
              </button>
            );
          }
        }
        return buttons;
      })}
    </div>}
  </div>;
}
