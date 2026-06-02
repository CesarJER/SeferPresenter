const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

// Use regex to remove unused functions block
content = content.replace(/const matchedSyncMap = audioState\.audioSrc[\s\S]*?\: undefined;/, '');

content = content.replace(/const handleSelectAudioTrack = \(src: string\) => \{[\s\S]*?\}\;\n/, '');

content = content.replace(/const togglePlayback = \(\) => \{[\s\S]*?\}\;\n/, '');

content = content.replace(/const formatTime = \(secs: number \| undefined\) => \{[\s\S]*?\}\;\n/, '');

content = content.replace(/const toggleMute = \(\) => \{[\s\S]*?\}\;\n/, '');

// Also remove unused imports
content = content.replace(/, Pause/, '');
content = content.replace(/, Volume2/, '');
content = content.replace(/, Settings/, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Cleaned MenuPopup.tsx');
