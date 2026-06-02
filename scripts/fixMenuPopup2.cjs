const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add AudioPanel import back if missing
if (!content.includes('import { AudioPanel }')) {
  content = content.replace(/(import \{ BackgroundSelector \} from '\.\/BackgroundSelector';)/, "import { AudioPanel } from './AudioPanel';\n$1");
}

// 2. Remove isScrubbing useEffects
content = content.replace(/useEffect\(\(\) => \{\n\s*console\.log\("\[MenuPopup\] localTime useEffect[\s\S]*?\}, \[videoState\?\.currentTime, activeSlide\?\.id, isScrubbing\]\);\n?/g, '');
content = content.replace(/useEffect\(\(\) => \{\n\s*if \(!isScrubbing\) return;\n\s*const handleRelease = \(\) => \{\n\s*setIsScrubbing\(false\);\n\s*\};\n\s*window\.addEventListener\('mouseup', handleRelease\);[\s\S]*?\}, \[isScrubbing\]\);\n?/g, '');
content = content.replace(/const \[isScrubbing, setIsScrubbing\] = useState<boolean>\(false\);\n?/g, '');
content = content.replace(/const \[localTime, setLocalTime\] = useState<number>\(0\);\n?/g, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed MenuPopup');
