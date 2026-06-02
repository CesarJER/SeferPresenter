const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

// Remove matchedSyncMap exactly
content = content.replace('  const matchedSyncMap = audioState.audioSrc\r\n    ? audioSyncMaps.find((m) => m.audioSrc === audioState.audioSrc)\r\n    : undefined;\r\n', '');
content = content.replace('  const matchedSyncMap = audioState.audioSrc\n    ? audioSyncMaps.find((m) => m.audioSrc === audioState.audioSrc)\n    : undefined;\n', '');

// Remove the two useEffects exactly using regular expressions to handle whitespace variations
content = content.replace(/useEffect\(\(\) => \{\s*console\.log\("\[MenuPopup\] localTime useEffect - videoState currentTime:", videoState\?\.currentTime, "activeSlideId:", activeSlide\?\.id, "isScrubbing:", isScrubbing\);\s*if \(\!isScrubbing\) \{\s*if \(videoState\) \{\s*setLocalTime\(videoState\.currentTime\);\s*\} else \{\s*setLocalTime\(activeSlide\?\.videoStart \?\? 0\);\s*\}\s*\}\s*\}, \[videoState\?\.currentTime, activeSlide\?\.id, isScrubbing\]\);/g, '');

content = content.replace(/useEffect\(\(\) => \{\s*if \(\!isScrubbing\) return;\s*const handleRelease = \(\) => \{\s*setIsScrubbing\(false\);\s*\};\s*window\.addEventListener\('mouseup', handleRelease\);\s*window\.addEventListener\('touchend', handleRelease\);\s*return \(\) => \{\s*window\.removeEventListener\('mouseup', handleRelease\);\s*window\.removeEventListener\('touchend', handleRelease\);\s*\};\s*\}, \[isScrubbing\]\);/g, '');


fs.writeFileSync(path, content, 'utf8');
