const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

// Fix imports
if (!content.includes("import { BackgroundSelector }")) {
  content = content.replace(/(import \{ FormatLegend \} from '\.\.\/shared\/FormatLegend';\n)/, "$1import { BackgroundSelector } from './BackgroundSelector';\n");
}
if (!content.includes("import { VideoControls }")) {
  content = content.replace(/(import \{ FormatLegend \} from '\.\.\/shared\/FormatLegend';\n)/, "$1import { VideoControls } from './VideoControls';\n");
}

// Remove prevVolume completely
content = content.replace(/const \[prevVolume, setPrevVolume\] = useState\(0\.7\);\n/, '');

// Remove localTime state
content = content.replace(/const \[localTime, setLocalTime\] = useState<number>\(0\);\n/, '');

// Remove unused Lock and Unlock
content = content.replace(/, Lock, Unlock/, '');

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed imports and removed states');
