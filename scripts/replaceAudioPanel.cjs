const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

let start = -1;
let end = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('{isMusicPanelOpen && (')) {
    start = i + 1;
  }
  if (start !== -1 && i > start && lines[i].includes(')}')) {
    if (lines[i - 1].includes('</div>') && lines[i - 2].includes('</div>')) {
      end = i - 1;
      break;
    }
  }
}

console.log('Start:', start, 'End:', end);

if (start !== -1 && end !== -1) {
  const replacement = `          <AudioPanel
            audioState={audioState}
            onAudioStateChange={onAudioStateChange}
            audioSyncMaps={audioSyncMaps}
            availableAudioFiles={availableAudioFiles}
            presentations={presentations}
            currentPresentation={currentPresentation}
            onSelectPresentation={onSelectPresentation}
            handleOpenAudioEditor={handleOpenAudioEditor}
          />`;
  
  lines.splice(start, end - start + 1, replacement);
  
  const importStatement = "import { AudioPanel } from './AudioPanel';";
  const importIndex = lines.findIndex(l => l.includes("import { ScriptureRangeEditor }"));
  lines.splice(importIndex, 0, importStatement);
  
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
  console.log('Replaced AudioPanel');
} else {
  console.log('Could not find bounds');
}
