const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add Imports
if (!content.includes('import { BackgroundSelector }')) {
  const insertIndex = content.indexOf("import { ScriptureRangeEditor }");
  if (insertIndex !== -1) {
    const importsToAdd = `import { BackgroundSelector } from './BackgroundSelector';
import { VideoControls } from './VideoControls';
`;
    content = content.slice(0, insertIndex) + importsToAdd + content.slice(insertIndex);
  }
}

// 2. Remove states and unused imports
content = content.replace(/const \[prevVolume, setPrevVolume\] = useState\(0\.7\);\n?/g, '');
content = content.replace(/const \[localTime, setLocalTime\] = useState<number>\(0\);\n?/g, '');
content = content.replace(/const \[isScrubbing, setIsScrubbing\] = useState<boolean>\(false\);\n?/g, '');
content = content.replace(/, Pause/, '');
content = content.replace(/, Volume2/, '');
content = content.replace(/, Settings/, '');
content = content.replace(/, Lock, Unlock/, '');

// 3. Remove unused functions
content = content.replace(/const matchedSyncMap = audioState\.audioSrc[\s\S]*?\: undefined;\n?/, '');
content = content.replace(/const handleSelectAudioTrack = \(src: string\) => \{[\s\S]*?\}\;\n?/, '');
content = content.replace(/const togglePlayback = \(\) => \{[\s\S]*?\}\;\n?/, '');
content = content.replace(/const formatTime = \(secs: number \| undefined\) => \{[\s\S]*?\}\;\n?/, '');
content = content.replace(/const toggleMute = \(\) => \{[\s\S]*?\}\;\n?/, '');

// 4. Remove useEffect for localTime
content = content.replace(/useEffect\(\(\) => \{\n\s*console\.log\("\[MenuPopup\] localTime useEffect[\s\S]*?\}, \[videoState\?\.currentTime, activeSlide\?\.id, isScrubbing\]\);\n?/, '');

// 5. Replace AudioPanel JSX
const audioPanelRegex = /\{\/\* Left: Track Select & Playback control \*\/\}[\s\S]*?\}\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/;
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

if (content.includes('Left: Track Select & Playback control')) {
  // It's safer to find exactly the div wrapping this block.
  // The block starts at `          <div className="shrink-0 border-b border-gray-700 bg-gray-950/80 p-3.5 flex flex-col md:flex-row md:items-end justify-between gap-3 text-xs">`
  // and ends at `          </div>` before `        )}` 
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
