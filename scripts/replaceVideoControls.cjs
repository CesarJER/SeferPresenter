const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace the video controls section
const regex = /\{\/\* ── Video Player Controller ──[\s\S]*?id="section-video-control"[\s\S]*?<\/div>\s*<\/div>\s*\)\}/;

const match = content.match(regex);
if (match) {
  const replacement = `                    {/* ── Video Player Controller ───────────────────────────────── */}
                    <VideoControls
                      activeSlide={activeSlide}
                      videoState={videoState}
                      onVideoStateChange={onVideoStateChange}
                    />`;
  content = content.replace(regex, replacement);
  
  // Add import
  const importStatement = "import { VideoControls } from './VideoControls';\n";
  const importRegex = /(import \{ BackgroundSelector \} from '\.\/BackgroundSelector';\n)/;
  content = content.replace(importRegex, `$1${importStatement}`);
  
  // Remove localTime state
  content = content.replace(/const \[localTime, setLocalTime\] = useState<number>\(0\);\n/, '');
  
  // Remove isScrubbing state
  content = content.replace(/const \[isScrubbing, setIsScrubbing\] = useState<boolean>\(false\);\n/, '');
  
  // Remove useEffect for localTime
  const effectRegex = /useEffect\(\(\) => \{\n\s*console\.log\("\[MenuPopup\] localTime useEffect[\s\S]*?\}, \[videoState\?\.currentTime, activeSlide\?\.id, isScrubbing\]\);\n/;
  content = content.replace(effectRegex, '');
  
  fs.writeFileSync(path, content, 'utf8');
  console.log('Replaced VideoControls');
} else {
  console.log('Could not find VideoControls section');
}
