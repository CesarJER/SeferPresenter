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
      {options.map((candidate, index) => <button type="button" className="rounded bg-emerald-800 px-2 py-1"
        key={`${candidateLabel(candidate)}-${index}`} onClick={() => onProject(candidate)}>{candidateLabel(candidate)}</button>)}
    </div>}
  </div>;
}
