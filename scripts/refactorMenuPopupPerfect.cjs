const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add Imports
const targetImportStr = "import { ScriptureRangeEditor } from './ScriptureRangeEditor';";
if (!content.includes('import { BackgroundSelector }')) {
  content = content.replace(targetImportStr, `import { BackgroundSelector } from './BackgroundSelector';\nimport { VideoControls } from './VideoControls';\nimport { AudioPanel } from './AudioPanel';\n${targetImportStr}`);
}

// 2. Remove states and unused imports
content = content.replace(/const \[prevVolume, setPrevVolume\] = useState\(0\.7\);\n?/g, '');
content = content.replace(/const \[localTime, setLocalTime\] = useState<number>\(0\);\n?/g, '');
content = content.replace(/const \[isScrubbing, setIsScrubbing\] = useState<boolean>\(false\);\n?/g, '');
content = content.replace(/, Pause/, '');
content = content.replace(/, Volume2/, '');
content = content.replace(/, Settings/, '');
content = content.replace(/, Lock, Unlock/, '');

// Remove matchedSyncMap
content = content.replace(/  const matchedSyncMap = audioState\.audioSrc\n    \? audioSyncMaps\.find\(\(m\) => m\.audioSrc === audioState\.audioSrc\)\n    \: undefined;\n/g, '');


// 3. Remove unused functions using exact boundaries if possible
const hsStart = content.indexOf('const handleSelectAudioTrack = (trackPath: string) => {');
const hsEnd = content.indexOf('  const handleOpenAudioEditor = () => {');
if (hsStart !== -1 && hsEnd !== -1) {
  content = content.substring(0, hsStart) + content.substring(hsEnd);
}

const ftStart = content.indexOf('  const formatTime = (timeSec: number) => {');
const ftEnd = content.indexOf('  const [mode, setMode] = useState<\'standard\' | \'trilingual\'>(\'standard\');');
if (ftStart !== -1 && ftEnd !== -1) {
  content = content.substring(0, ftStart) + content.substring(ftEnd);
}

// 4. Remove useEffects for localTime and isScrubbing
// Use while loop because there could be multiple or maybe regex is better for exactly this block
// Replace any useEffect block that has "isScrubbing"
const replaceEffectWithScrubbing = () => {
  const startStr = '  useEffect(() => {\n';
  let i = 0;
  while ((i = content.indexOf(startStr, i)) !== -1) {
    const endStr = '});\n';
    const endStr2 = ']);\n';
    let end1 = content.indexOf(endStr, i);
    let end2 = content.indexOf(endStr2, i);
    let end = -1;
    if (end1 !== -1 && end2 !== -1) {
      end = Math.min(end1, end2) + (Math.min(end1, end2) === end1 ? endStr.length : endStr2.length);
    } else if (end1 !== -1) {
      end = end1 + endStr.length;
    } else if (end2 !== -1) {
      end = end2 + endStr2.length;
    }

    if (end !== -1) {
      const block = content.substring(i, end);
      if (block.includes('isScrubbing')) {
        content = content.substring(0, i) + content.substring(end);
        // Do not increment i, we just removed a block
      } else {
        i = end;
      }
    } else {
      break;
    }
  }
};
replaceEffectWithScrubbing();

// 5. Replace AudioPanel JSX
const audioPanelReplacement = `<AudioPanel
            audioState={audioState}
            onAudioStateChange={onAudioStateChange}
            audioSyncMaps={audioSyncMaps}
            availableAudioFiles={availableAudioFiles}
            presentations={presentations}
            currentPresentation={currentPresentation}
            onSelectPresentation={onSelectPresentation}
            handleOpenAudioEditor={handleOpenAudioEditor}
          />`;

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
if (start !== -1 && end !== -1) {
  lines.splice(start, end - start + 1, audioPanelReplacement);
  content = lines.join('\n');
}

// 6. Replace BackgroundSelector JSX
const bgRegex = /\{\/\*\s*Fondo\s*\*\/\}\s*<div className="flex-1 space-y-1\.5 min-w-0">[\s\S]*?<Unlock size=\{15\} \/>\}\s*<\/button>\s*<\/div>\s*<\/div>/;
const bgReplacement = `{/* Fondo */}
                <BackgroundSelector
                  activeBackground={activeBackground}
                  currentPresentation={currentPresentation}
                  backgrounds={backgrounds}
                  onSelectBackgroundOverride={onSelectBackgroundOverride}
                  backgroundLock={backgroundLock}
                  onToggleBackgroundLock={onToggleBackgroundLock}
                />`;
content = content.replace(bgRegex, bgReplacement);

// 7. Replace VideoControls JSX
const videoRegex = /\{\/\* ── Video Player Controller ──[\s\S]*?id="section-video-control"[\s\S]*?<\/div>\s*<\/div>\s*\)\}/;
const videoReplacement = `{/* ── Video Player Controller ───────────────────────────────── */}
                    <VideoControls
                      activeSlide={activeSlide!}
                      videoState={videoState}
                      onVideoStateChange={onVideoStateChange}
                    />`;
content = content.replace(videoRegex, videoReplacement);

fs.writeFileSync(path, content, 'utf8');
console.log('All replacements applied successfully.');
